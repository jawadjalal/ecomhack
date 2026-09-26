"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useCart } from "./providers";
import { CartIcon, ChevronDown, GridIcon, SearchIcon, SendIcon, TagIcon, UsersIcon } from "./icons";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Rackd home" data-darwin="logo">
      <b>RACKD</b>
      <span>WHOLESALE</span>
    </Link>
  );
}

function SearchBox({ className }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/bundles?q=${encodeURIComponent(q.trim())}` : "/bundles");
  };
  return (
    <form className={`search ${className ?? ""}`} role="search" onSubmit={submit}>
      <SearchIcon />
      <input name="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search for "Y2K"' aria-label="Search bundles" />
    </form>
  );
}

export function Header() {
  const { count, ready } = useCart();
  return (
    <header className="header" id="site-header">
      <div className="header-row">
        <Logo />
        <nav className="nav" aria-label="Main">
          <Link href="/bundles">
            <GridIcon /> Categories
          </Link>
          <Link href="/bundles?sort=bestselling">
            <TagIcon /> Brands
          </Link>
          <Link href="/#suppliers">
            <UsersIcon /> Suppliers
          </Link>
        </nav>
        <SearchBox className="desk" />
        <div className="header-actions">
          <button type="button" className="icon-btn send" aria-label="Messages">
            <SendIcon />
          </button>
          <button type="button" className="icon-btn lang" aria-label="Language">
            EN <ChevronDown style={{ width: 16, height: 16 }} />
          </button>
          <Link href="/cart" className="icon-btn" aria-label={`Cart, ${count} items`} id="header-cart" data-darwin="header-cart">
            <CartIcon />
            {ready && count > 0 && <span className="cart-count">{count}</span>}
          </Link>
          <Link href="/account?mode=signup" className="hdr-btn signup">
            Sign Up
          </Link>
          <Link href="/account" className="hdr-btn login">
            Login
          </Link>
        </div>
      </div>
      <SearchBox className="mobile-only" />
    </header>
  );
}
