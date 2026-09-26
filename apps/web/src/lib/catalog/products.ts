/**
 * Demo catalog for PACE, a London running brand.
 * Shared by the storefront, the agent API, the simulator and the optimizer.
 * Money is integer pence.
 */

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: "road" | "trail" | "racing" | "accessories";
  tagline: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  rating: number;
  reviewCount: number;
  /** Sample reviews for the product page. */
  reviews: { author: string; rating: number; title: string; body: string }[];
  features: string[];
  attributes: Record<string, string | number | boolean>;
  /** UK sizes → units in stock. Accessories use "One size". */
  stock: Record<string, number>;
  colors: { name: string; hex: string }[];
  /** Standard delivery time in days. */
  deliveryDays: number;
  returnDays: number;
  freeReturns: boolean;
  /** Merchant agent never sells below this (pence). */
  floorPrice: number;
  /** Path under /public, or a remote URL. Storefront may render art instead. */
  image: string;
  bestsellerRank: number;
}

export const SHIPPING_FEE = 495; // £4.95 standard UK delivery

export const PRODUCTS: Product[] = [
  {
    id: "p_aurora",
    slug: "aurora-daily-trainer",
    name: "Aurora Daily Trainer",
    category: "road",
    tagline: "The shoe for every mile of the week.",
    description:
      "A cushioned daily trainer with a responsive nitrogen-infused foam midsole and an engineered knit upper that breathes on long runs.",
    price: 11500,
    compareAtPrice: 13000,
    rating: 4.7,
    reviewCount: 1284,
    reviews: [
      { author: "Priya S.", rating: 5, title: "Marathon block approved", body: "Did my whole 16-week block in these. Zero blisters." },
      { author: "Tom H.", rating: 4, title: "Comfy, runs slightly long", body: "Great cushioning. Go half a size down." },
    ],
    features: ["Nitrogen-infused foam", "Engineered knit upper", "8mm drop", "Reflective heel tab"],
    attributes: { weight_g: 265, drop_mm: 8, terrain: "road", cushioning: "high", vegan: true },
    stock: { "6": 4, "7": 12, "8": 18, "9": 22, "10": 9, "11": 3, "12": 0 },
    colors: [
      { name: "Midnight", hex: "#1e293b" },
      { name: "Solar", hex: "#f97316" },
    ],
    deliveryDays: 2,
    returnDays: 60,
    freeReturns: true,
    floorPrice: 9800,
    image: "/products/aurora.svg",
    bestsellerRank: 1,
  },
  {
    id: "p_ridge",
    slug: "ridge-trail-pro",
    name: "Ridge Trail Pro",
    category: "trail",
    tagline: "Grip that doesn't flinch.",
    description:
      "Aggressive 5mm lugs, a rock plate and a waterproof membrane for muddy British trails and fell races.",
    price: 13500,
    rating: 4.6,
    reviewCount: 642,
    reviews: [
      { author: "Megan L.", rating: 5, title: "Peak District tested", body: "Stuck to wet limestone like glue." },
      { author: "Owen R.", rating: 4, title: "Stiff at first", body: "Took 20 miles to break in, now perfect." },
    ],
    features: ["5mm lugs", "Rock plate", "Waterproof membrane", "Gusseted tongue"],
    attributes: { weight_g: 310, drop_mm: 6, terrain: "trail", cushioning: "medium", waterproof: true, vegan: false },
    stock: { "6": 2, "7": 6, "8": 10, "9": 14, "10": 11, "11": 5, "12": 2 },
    colors: [
      { name: "Moss", hex: "#3f6212" },
      { name: "Slate", hex: "#475569" },
    ],
    deliveryDays: 3,
    returnDays: 60,
    freeReturns: true,
    floorPrice: 11500,
    image: "/products/ridge.svg",
    bestsellerRank: 3,
  },
  {
    id: "p_velocity",
    slug: "velocity-carbon",
    name: "Velocity Carbon",
    category: "racing",
    tagline: "Race day, unfair advantage.",
    description:
      "A full-length carbon plate and PEBA foam super shoe for 5k to marathon PBs. World Athletics legal.",
    price: 22000,
    rating: 4.8,
    reviewCount: 389,
    reviews: [
      { author: "James K.", rating: 5, title: "Sub-3 finally", body: "Took four minutes off my marathon. Worth every penny." },
      { author: "Aisha B.", rating: 5, title: "Bouncy", body: "Feels like cheating on tempo runs." },
    ],
    features: ["Full-length carbon plate", "PEBA foam", "World Athletics legal", "Monomesh upper"],
    attributes: { weight_g: 198, drop_mm: 8, terrain: "road", cushioning: "max", carbon_plate: true, vegan: true },
    stock: { "6": 1, "7": 3, "8": 5, "9": 4, "10": 2, "11": 1, "12": 0 },
    colors: [{ name: "Volt", hex: "#a3e635" }],
    deliveryDays: 2,
    returnDays: 30,
    freeReturns: false,
    floorPrice: 19500,
    image: "/products/velocity.svg",
    bestsellerRank: 2,
  },
  {
    id: "p_tempo",
    slug: "tempo-lite",
    name: "Tempo Lite",
    category: "road",
    tagline: "Light, fast, no fuss.",
    description: "A lightweight trainer for tempo sessions and parkrun PBs, with a snappy supercritical foam.",
    price: 9500,
    compareAtPrice: 11000,
    rating: 4.4,
    reviewCount: 811,
    reviews: [
      { author: "Chloe W.", rating: 4, title: "Great for parkrun", body: "Light and fast. Not for long runs." },
      { author: "Dan P.", rating: 5, title: "Bargain", body: "Best value speed shoe I've owned." },
    ],
    features: ["Supercritical foam", "6mm drop", "Breathable mesh", "Durable rubber outsole"],
    attributes: { weight_g: 225, drop_mm: 6, terrain: "road", cushioning: "medium", vegan: true },
    stock: { "6": 8, "7": 15, "8": 20, "9": 18, "10": 14, "11": 7, "12": 4 },
    colors: [
      { name: "Chalk", hex: "#e7e5e4" },
      { name: "Signal Red", hex: "#dc2626" },
    ],
    deliveryDays: 2,
    returnDays: 60,
    freeReturns: true,
    floorPrice: 7900,
    image: "/products/tempo.svg",
    bestsellerRank: 4,
  },
  {
    id: "p_summit",
    slug: "summit-ultra",
    name: "Summit Ultra",
    category: "trail",
    tagline: "Built for the long way round.",
    description: "Max-cushion trail shoe for ultras, with a wide toe box and a sticky Vibram-style outsole.",
    price: 15500,
    rating: 4.5,
    reviewCount: 274,
    reviews: [
      { author: "Rosie T.", rating: 5, title: "100k comfy", body: "Feet felt fresh at the end of a 100k." },
      { author: "Liam G.", rating: 4, title: "Chunky but worth it", body: "Heavy-ish but the cushioning is unreal." },
    ],
    features: ["Max cushion", "Wide toe box", "Sticky outsole", "Gaiter attachment"],
    attributes: { weight_g: 330, drop_mm: 4, terrain: "trail", cushioning: "max", waterproof: false, vegan: true },
    stock: { "6": 0, "7": 4, "8": 7, "9": 9, "10": 6, "11": 3, "12": 1 },
    colors: [{ name: "Ember", hex: "#b45309" }],
    deliveryDays: 4,
    returnDays: 60,
    freeReturns: true,
    floorPrice: 13000,
    image: "/products/summit.svg",
    bestsellerRank: 6,
  },
  {
    id: "p_city",
    slug: "city-recovery",
    name: "City Recovery",
    category: "road",
    tagline: "Easy days and everyday wear.",
    description: "A soft, stable recovery shoe that works just as well on the commute as on easy runs.",
    price: 8500,
    rating: 4.3,
    reviewCount: 522,
    reviews: [
      { author: "Nina F.", rating: 4, title: "All-day comfy", body: "I wear these to the office now." },
      { author: "Sam O.", rating: 4, title: "Solid", body: "Good for recovery jogs, bit heavy for faster stuff." },
    ],
    features: ["Soft EVA midsole", "Stable base", "Recycled upper", "Pull tab"],
    attributes: { weight_g: 290, drop_mm: 10, terrain: "road", cushioning: "high", vegan: true },
    stock: { "6": 10, "7": 14, "8": 16, "9": 16, "10": 12, "11": 8, "12": 5 },
    colors: [
      { name: "Fog", hex: "#9ca3af" },
      { name: "Navy", hex: "#1e3a8a" },
    ],
    deliveryDays: 2,
    returnDays: 60,
    freeReturns: true,
    floorPrice: 6900,
    image: "/products/city.svg",
    bestsellerRank: 5,
  },
  {
    id: "p_socks",
    slug: "blister-shield-socks",
    name: "Blister Shield Socks (3-pack)",
    category: "accessories",
    tagline: "Seamless. Cushioned. Never slip.",
    description: "Merino-blend running socks with a seamless toe and targeted cushioning.",
    price: 1800,
    rating: 4.8,
    reviewCount: 2051,
    reviews: [{ author: "Kate M.", rating: 5, title: "Best socks", body: "No blisters since switching." }],
    features: ["Merino blend", "Seamless toe", "Arch support"],
    attributes: { material: "merino blend", pack: 3 },
    stock: { "One size": 120 },
    colors: [{ name: "Black", hex: "#111827" }],
    deliveryDays: 2,
    returnDays: 30,
    freeReturns: false,
    floorPrice: 1200,
    image: "/products/socks.svg",
    bestsellerRank: 7,
  },
  {
    id: "p_vest",
    slug: "flow-hydration-vest",
    name: "Flow Hydration Vest 5L",
    category: "accessories",
    tagline: "Everything you need, nothing that bounces.",
    description: "A 5L running vest with two 500ml soft flasks and phone-sized chest pockets.",
    price: 7500,
    rating: 4.6,
    reviewCount: 318,
    reviews: [{ author: "Ben A.", rating: 5, title: "No bounce", body: "Stays put even on descents." }],
    features: ["5L capacity", "2x 500ml flasks", "Chest pockets", "Whistle"],
    attributes: { capacity_l: 5, flasks: 2 },
    stock: { "S/M": 12, "L/XL": 9 },
    colors: [{ name: "Graphite", hex: "#374151" }],
    deliveryDays: 3,
    returnDays: 30,
    freeReturns: false,
    floorPrice: 6000,
    image: "/products/vest.svg",
    bestsellerRank: 8,
  },
];

export function getProduct(idOrSlug: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
}

export function inStock(product: Product, size?: string): boolean {
  if (size) return (product.stock[size] ?? 0) > 0;
  return Object.values(product.stock).some((n) => n > 0);
}
