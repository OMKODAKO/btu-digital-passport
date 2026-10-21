// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title BTU AI Skills Digital Passport registry
/// @notice One record per issued passport version: the SHA-256 of the exact PDF bytes, the version
///         number and an opaque passport reference. No name, email, student number or Passport ID
///         is ever stored here.
/// @dev Trust model:
///      - `admin` is the registry governance key. In production this is a BTU-controlled multisig whose
///        address BTU publishes on its own domain (see chain/README.md, "BTU trust anchor").
///      - Only addresses the admin has authorised as issuers can register versions. Each issuer entry
///        carries a label and a `testOnly` flag, so a hackathon test issuer can never be mistaken for
///        an official BTU issuer.
///      - Records are written once and never changed or deleted.
contract PassportRegistry {
    struct Issuer {
        bool active;
        bool testOnly;
        uint64 authorisedAt;   // block timestamp of the first authorisation
        uint64 revokedAt;      // 0 while active
        string label;
    }

    struct Record {
        bytes32 pdfSha256;     // SHA-256 of the exact issued PDF file
        bytes32 passportRef;   // random per-passport reference kept by BTU; not derived from personal data
        uint32 versionNo;
        address issuer;
        uint64 registeredAt;   // block timestamp
        uint64 blockNumber;
    }

    address public admin;
    mapping(address => Issuer) private _issuers;
    mapping(bytes32 => Record) private _records;            // key: SHA-256 of the version's Verification Code
    mapping(bytes32 => bytes32[]) private _versionsOf;      // passportRef => record keys, in version order
    mapping(bytes32 => bool) private _hashUsed;             // one PDF file belongs to one version only

    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event IssuerSet(address indexed issuer, bool active, bool testOnly, string label);
    event VersionRegistered(
        bytes32 indexed codeKey, bytes32 indexed passportRef, address indexed issuer, uint32 versionNo, bytes32 pdfSha256
    );

    error NotAdmin();
    error NotAuthorisedIssuer(address caller);
    error AlreadyRegistered(bytes32 codeKey);
    error HashAlreadyRegistered(bytes32 pdfSha256);
    error VersionNotIncreasing(bytes32 passportRef, uint32 versionNo, uint32 latest);
    error InvalidInput();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        if (admin_ == address(0)) revert InvalidInput();
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert InvalidInput();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function setIssuer(address account, bool active, bool testOnly, string calldata label) external onlyAdmin {
        if (account == address(0)) revert InvalidInput();
        Issuer storage i = _issuers[account];
        if (active) {
            // first authorisation time is kept: updating a label or flag doesn't move it
            if (i.authorisedAt == 0) i.authorisedAt = uint64(block.timestamp);
            i.revokedAt = 0;
        } else if (i.active) {
            i.revokedAt = uint64(block.timestamp);
        }
        i.active = active;
        i.testOnly = testOnly;
        i.label = label;
        emit IssuerSet(account, active, testOnly, label);
    }

    function issuer(address account) external view returns (Issuer memory) {
        return _issuers[account];
    }

    /// @notice Registers one issued version. Reverts if the caller is not an active issuer, if the
    ///         code or the PDF hash is already registered, or if the version number does not increase.
    function register(bytes32 codeKey, bytes32 passportRef, uint32 versionNo, bytes32 pdfSha256) public {
        if (!_issuers[msg.sender].active) revert NotAuthorisedIssuer(msg.sender);
        if (codeKey == bytes32(0) || passportRef == bytes32(0) || pdfSha256 == bytes32(0) || versionNo == 0) {
            revert InvalidInput();
        }
        if (_records[codeKey].registeredAt != 0) revert AlreadyRegistered(codeKey);
        if (_hashUsed[pdfSha256]) revert HashAlreadyRegistered(pdfSha256);
        bytes32[] storage list = _versionsOf[passportRef];
        if (list.length > 0) {
            uint32 latest = _records[list[list.length - 1]].versionNo;
            if (versionNo <= latest) revert VersionNotIncreasing(passportRef, versionNo, latest);
        }
        _records[codeKey] = Record(pdfSha256, passportRef, versionNo, msg.sender, uint64(block.timestamp), uint64(block.number));
        _hashUsed[pdfSha256] = true;
        list.push(codeKey);
        emit VersionRegistered(codeKey, passportRef, msg.sender, versionNo, pdfSha256);
    }

    /// @notice Same as calling register() for each entry, in one transaction (all or nothing).
    function registerBatch(
        bytes32[] calldata codeKeys,
        bytes32[] calldata passportRefs,
        uint32[] calldata versionNos,
        bytes32[] calldata pdfSha256s
    ) external {
        uint256 n = codeKeys.length;
        if (n == 0 || n > 100 || passportRefs.length != n || versionNos.length != n || pdfSha256s.length != n) {
            revert InvalidInput();
        }
        for (uint256 k = 0; k < n; k++) {
            register(codeKeys[k], passportRefs[k], versionNos[k], pdfSha256s[k]);
        }
    }

    /// @notice The record for a verification code key; registeredAt == 0 means "no such version".
    function getRecord(bytes32 codeKey) external view returns (Record memory) {
        return _records[codeKey];
    }

    /// @notice All registered versions of one passport, oldest first; the last one is the latest.
    function versionsOf(bytes32 passportRef) external view returns (bytes32[] memory) {
        return _versionsOf[passportRef];
    }
}
