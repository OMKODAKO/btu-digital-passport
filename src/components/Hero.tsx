// Black band with pastel-pink display type, after BTU's "10 years of innovation" banner.
export default function Hero({ title, sub }: { title: string; sub?: string }) {
  const star = (n: number, r1: number, r2: number) =>
    Array.from({ length: n * 2 }, (_, i) => {
      const a = (Math.PI * i) / n, r = i % 2 ? r2 : r1;
      return `${(30 + r * Math.sin(a)).toFixed(1)},${(30 - r * Math.cos(a)).toFixed(1)}`;
    }).join(" ");
  return (
    <section className="hero">
      <div className="hero-inner">
        <div className="hero-shapes" aria-hidden="true">
          <svg viewBox="0 0 60 60"><polygon points={star(12, 28, 3)} /></svg>
          <svg viewBox="0 0 60 60"><polygon points={star(12, 28, 24)} /></svg>
          <svg viewBox="0 0 60 60"><polygon points={star(14, 28, 18)} /></svg>
          <svg viewBox="0 0 60 60"><polygon points={star(24, 28, 24)} /></svg>
        </div>
        <h1 className="hero-title">{title}</h1>
        {sub && <p className="hero-sub">{sub}</p>}
      </div>
    </section>
  );
}
