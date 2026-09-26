import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page empty">
      <h1 className="page-title">That bundle has sold out</h1>
      <p className="muted">Or the link is wrong. New stock lands every day.</p>
      <Link href="/bundles" className="btn btn-ink " style={{ marginTop: 20 }}>
        Browse bundles
      </Link>
    </div>
  );
}
