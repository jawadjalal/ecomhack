export function Stars({ rating, count, small }: { rating: number; count?: number; small?: boolean }) {
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <span className={`stars ${small ? "stars-small" : ""}`} data-darwin="rating" aria-label={`Rated ${rating} out of 5${count ? ` from ${count.toLocaleString("en-GB")} reviews` : ""}`}>
      <span className="stars-track" aria-hidden="true">
        ★★★★★
        <span className="stars-fill" style={{ width: `${pct}%` }}>
          ★★★★★
        </span>
      </span>
      <span className="stars-text">
        {rating.toFixed(1)}
        {count ? ` (${count.toLocaleString("en-GB")})` : ""}
      </span>
    </span>
  );
}
