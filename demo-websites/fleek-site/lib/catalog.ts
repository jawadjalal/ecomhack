/**
 * Demo catalog: wholesale vintage bundles from fictional suppliers. Money is integer pence.
 * All names, suppliers, reviews and numbers are invented for the demo.
 */

export type Garment = "tee" | "jeans" | "jacket" | "hoodie" | "knit" | "cap" | "bag" | "shorts" | "rugby";
export type CategoryId = "denim" | "outerwear" | "sportswear" | "knitwear" | "tees" | "accessories";

export interface Category {
  id: CategoryId;
  name: string;
  blurb: string;
  garment: Garment;
  colors: string[];
  bg: string;
}

export const CATEGORIES: Category[] = [
  { id: "denim", name: "Denim", blurb: "Straight, bootcut and baggy jeans", garment: "jeans", colors: ["#3b5a85", "#6d8fb8", "#243b5c"], bg: "#e9e3d6" },
  { id: "outerwear", name: "Outerwear", blurb: "Workwear, fleeces and field jackets", garment: "jacket", colors: ["#8a5a2b", "#5b6b3a", "#2d2d2d"], bg: "#efe7da" },
  { id: "sportswear", name: "Sportswear", blurb: "Track tops, shell suits, jerseys", garment: "hoodie", colors: ["#c8322b", "#1f4aa8", "#f2c230"], bg: "#e6e9ec" },
  { id: "knitwear", name: "Knitwear", blurb: "Cable knits, cardigans, lambswool", garment: "knit", colors: ["#b24a3b", "#d9b36c", "#4f6b5a"], bg: "#f1ebe1" },
  { id: "tees", name: "Graphic tees", blurb: "Band, tour, souvenir and Y2K tees", garment: "tee", colors: ["#1e1e1e", "#f4f1ea", "#8b2d2d"], bg: "#e8e4dc" },
  { id: "accessories", name: "Caps & bags", blurb: "Caps, totes and shoulder bags", garment: "cap", colors: ["#2f4f3a", "#c9a26b", "#7c2a2a"], bg: "#ece6da" },
];

export interface Supplier {
  id: string;
  name: string;
  city: string;
  rating: number;
  repeatBuyers: number;
  since: number;
  dispatchDays: [number, number];
}

export const SUPPLIERS: Supplier[] = [
  { id: "northgate", name: "Northgate Vintage", city: "Manchester, UK", rating: 4.9, repeatBuyers: 1840, since: 2019, dispatchDays: [1, 2] },
  { id: "tagus", name: "Tagus Rag House", city: "Lisbon, PT", rating: 4.8, repeatBuyers: 960, since: 2020, dispatchDays: [2, 3] },
  { id: "moravia", name: "Moravia Archive", city: "Brno, CZ", rating: 4.7, repeatBuyers: 612, since: 2021, dispatchDays: [2, 4] },
  { id: "lakeshore", name: "Lakeshore Surplus", city: "Toronto, CA", rating: 4.8, repeatBuyers: 1203, since: 2018, dispatchDays: [3, 5] },
  { id: "seventh", name: "Seventh Street Sorters", city: "Leeds, UK", rating: 4.6, repeatBuyers: 455, since: 2022, dispatchDays: [1, 3] },
];

export interface Review {
  author: string;
  platform: string;
  rating: number;
  text: string;
  date: string;
}

export interface Bundle {
  id: string;
  name: string;
  category: CategoryId;
  supplier: string;
  /** Bundle price, pence. */
  price: number;
  /** Price before the current discount, pence (null = not discounted). */
  was: number | null;
  pieces: number;
  weightKg: number;
  grade: "A" | "A/B" | "B";
  era: string;
  sizes: string;
  brands: string;
  /** Bundles left in stock. */
  stock: number;
  /** Units sold in the last 30 days (for "bestselling"). */
  sold30d: number;
  rating: number;
  reviewCount: number;
  garments: Garment[];
  colors: string[];
  bg: string;
  description: string[];
  reviews: Review[];
  /** Mirror-mode items only (see CartLine.ext in commerce.ts). */
  image?: string;
  url?: string;
  shippingIncluded?: boolean;
}

export const BUNDLES: Bundle[] = [
  {
    id: "carhartt-style-workwear-jackets",
    name: "Workwear chore & canvas jackets",
    category: "outerwear",
    supplier: "northgate",
    price: 34900,
    was: 42900,
    pieces: 20,
    weightKg: 24,
    grade: "A/B",
    era: "90s–00s",
    sizes: "M–XXL, mostly L",
    brands: "Mixed US workwear labels, some unbranded",
    stock: 4,
    sold30d: 61,
    rating: 4.8,
    reviewCount: 142,
    garments: ["jacket", "jacket", "jacket", "jacket"],
    colors: ["#8a5a2b", "#b07a3c", "#4b4a3a", "#2d2d2d"],
    bg: "#e9e1d2",
    description: [
      "Twenty duck-canvas and chore jackets, hand-picked from our Manchester warehouse. Expect faded brown, black and olive, with honest wear: frayed cuffs, paint marks and the odd missing button, all of which resellers tell us sell well as 'authentic workwear'.",
      "Every piece is checked for large tears and odours before it is bagged. Grade A/B means at least 70% of the bundle is grade A (no visible faults) and the rest is grade B (small, fixable faults).",
      "Sizes run large. Most pieces are L; a handful of XXL. Linings vary: blanket, quilted and unlined.",
    ],
    reviews: [
      { author: "Priya S.", platform: "Depop seller", rating: 5, text: "Sold 14 of 20 in the first week. Two had busted zips but the rest were spot on.", date: "2026-08-19" },
      { author: "Tom H.", platform: "eBay seller", rating: 5, text: "Exactly the mix in the description. Arrived in 3 days, well packed.", date: "2026-07-30" },
      { author: "Lena K.", platform: "Vinted seller", rating: 4, text: "Great margins. Would like more medium sizes.", date: "2026-07-02" },
    ],
  },
  {
    id: "y2k-baggy-denim",
    name: "Y2K baggy & carpenter jeans",
    category: "denim",
    supplier: "tagus",
    price: 19900,
    was: 24900,
    pieces: 25,
    weightKg: 16,
    grade: "A",
    era: "Y2K",
    sizes: "W28–W38",
    brands: "Mixed high-street and skate labels",
    stock: 11,
    sold30d: 88,
    rating: 4.7,
    reviewCount: 203,
    garments: ["jeans", "jeans", "jeans", "shorts"],
    colors: ["#3b5a85", "#6d8fb8", "#243b5c", "#8aa4c4"],
    bg: "#e6e0d4",
    description: [
      "Twenty-five pairs of wide-leg, baggy and carpenter jeans from the early 2000s. Light and mid washes, a few with hammer loops and double knees.",
      "All grade A: no rips unless part of the original design, zips tested, pockets intact. Lisbon-sorted and pressed flat before dispatch.",
      "Waist sizes W28–W38. Leg lengths are mixed; we note the spread on the packing slip.",
    ],
    reviews: [
      { author: "Jas M.", platform: "Depop seller", rating: 5, text: "Baggy denim flies on Depop. This bundle paid for itself twice over.", date: "2026-09-01" },
      { author: "Ola B.", platform: "Whatnot seller", rating: 4, text: "Good washes, a couple of very small waists.", date: "2026-08-11" },
    ],
  },
  {
    id: "90s-track-tops",
    name: "90s track tops & shell jackets",
    category: "sportswear",
    supplier: "moravia",
    price: 15900,
    was: null,
    pieces: 18,
    weightKg: 9,
    grade: "A/B",
    era: "90s",
    sizes: "S–XL",
    brands: "Mixed sportswear labels",
    stock: 7,
    sold30d: 47,
    rating: 4.6,
    reviewCount: 88,
    garments: ["hoodie", "jacket", "hoodie", "jacket"],
    colors: ["#1f4aa8", "#c8322b", "#1b7a5a", "#f2c230"],
    bg: "#e4e8ec",
    description: [
      "Eighteen zip-up track tops and nylon shell jackets with bold colour blocking. Popular for festival and terrace-style shops.",
      "Grade A/B: a few pieces have faded logos or light pilling. No broken zips.",
    ],
    reviews: [{ author: "Marco D.", platform: "Vinted seller", rating: 5, text: "Colours are amazing in person. Quick dispatch.", date: "2026-08-24" }],
  },
  {
    id: "cable-knit-jumpers",
    name: "Cable-knit & fisherman jumpers",
    category: "knitwear",
    supplier: "northgate",
    price: 21900,
    was: 25900,
    pieces: 22,
    weightKg: 14,
    grade: "A",
    era: "80s–90s",
    sizes: "S–XL",
    brands: "Mixed British and Irish knitwear",
    stock: 3,
    sold30d: 52,
    rating: 4.9,
    reviewCount: 121,
    garments: ["knit", "knit", "knit", "knit"],
    colors: ["#e9dcc0", "#b24a3b", "#4f6b5a", "#d9b36c"],
    bg: "#efe8dc",
    description: [
      "Twenty-two chunky cable and fisherman jumpers: cream, oat, forest and rust. Wool and wool-blend only, no acrylic.",
      "Grade A: washed, de-bobbled and checked for moth holes. Autumn's best seller for three years running.",
    ],
    reviews: [
      { author: "Hannah P.", platform: "Etsy seller", rating: 5, text: "Beautiful knits, sold out my shop drop in a day.", date: "2026-09-10" },
      { author: "Dev R.", platform: "Depop seller", rating: 5, text: "All wool as promised. Will reorder.", date: "2026-08-28" },
    ],
  },
  {
    id: "band-tour-tees",
    name: "Band, tour & souvenir tees",
    category: "tees",
    supplier: "lakeshore",
    price: 12900,
    was: 15900,
    pieces: 30,
    weightKg: 7,
    grade: "A/B",
    era: "90s–00s",
    sizes: "M–XXL",
    brands: "Single-stitch and modern blanks",
    stock: 16,
    sold30d: 104,
    rating: 4.5,
    reviewCount: 256,
    garments: ["tee", "tee", "tee", "tee"],
    colors: ["#1e1e1e", "#f4f1ea", "#8b2d2d", "#2d4a6b"],
    bg: "#e7e3db",
    description: [
      "Thirty graphic tees: bands, tours, holiday souvenirs and sports teams. Around a third are single-stitch.",
      "Grade A/B: some cracking on prints, which is expected on vintage graphics. No stains on the front.",
    ],
    reviews: [{ author: "Kai L.", platform: "eBay seller", rating: 4, text: "A few duds, but the good ones sell for £30+.", date: "2026-08-15" }],
  },
  {
    id: "rugby-shirts",
    name: "Striped rugby shirts",
    category: "sportswear",
    supplier: "seventh",
    price: 24900,
    was: 28900,
    pieces: 16,
    weightKg: 11,
    grade: "A",
    era: "90s",
    sizes: "M–XL",
    brands: "Mixed heritage and club labels",
    stock: 5,
    sold30d: 39,
    rating: 4.8,
    reviewCount: 64,
    garments: ["rugby", "rugby", "rugby", "rugby"],
    colors: ["#1d2d5a", "#c8322b", "#1b5e3b", "#f2c230"],
    bg: "#e9e5dc",
    description: [
      "Sixteen heavyweight rugby shirts with contrast collars: hoops, stripes and block colours.",
      "Grade A: collars intact, no fading at the seams.",
    ],
    reviews: [{ author: "Freya W.", platform: "Vinted seller", rating: 5, text: "Heavy cotton, great condition, sold fast.", date: "2026-09-05" }],
  },
  {
    id: "fleece-mix",
    name: "Outdoor fleece mix",
    category: "outerwear",
    supplier: "lakeshore",
    price: 17900,
    was: null,
    pieces: 20,
    weightKg: 12,
    grade: "A/B",
    era: "90s–00s",
    sizes: "S–XXL",
    brands: "Mixed outdoor labels",
    stock: 9,
    sold30d: 58,
    rating: 4.7,
    reviewCount: 97,
    garments: ["jacket", "hoodie", "jacket", "hoodie"],
    colors: ["#2f6b62", "#7a4b8c", "#c46a2b", "#2d2d2d"],
    bg: "#e3e8e3",
    description: [
      "Twenty zip and half-zip fleeces in outdoor colourways. Teal, purple and burnt orange lead the mix.",
      "Grade A/B: light pilling on some, zips all work.",
    ],
    reviews: [{ author: "Sam O.", platform: "Depop seller", rating: 5, text: "Great autumn stock.", date: "2026-09-12" }],
  },
  {
    id: "baseball-caps",
    name: "Vintage baseball caps",
    category: "accessories",
    supplier: "moravia",
    price: 8900,
    was: 10900,
    pieces: 40,
    weightKg: 5,
    grade: "A/B",
    era: "90s–00s",
    sizes: "One size / snapback",
    brands: "Mixed sports, souvenir and brand caps",
    stock: 13,
    sold30d: 72,
    rating: 4.4,
    reviewCount: 131,
    garments: ["cap", "cap", "cap", "cap"],
    colors: ["#2f4f3a", "#c9a26b", "#7c2a2a", "#1d2d5a"],
    bg: "#ece6da",
    description: [
      "Forty caps: snapbacks, strapbacks and fitted. Sports teams, souvenir and embroidered logos.",
      "Grade A/B: some sweat marks on the band, washed and reshaped.",
    ],
    reviews: [{ author: "Rico A.", platform: "Whatnot seller", rating: 4, text: "Great for live shows, quick flips.", date: "2026-08-02" }],
  },
  {
    id: "leather-shoulder-bags",
    name: "Leather shoulder bags",
    category: "accessories",
    supplier: "tagus",
    price: 29900,
    was: 36900,
    pieces: 12,
    weightKg: 8,
    grade: "A",
    era: "80s–00s",
    sizes: "Mixed sizes",
    brands: "Mixed designer-diffusion and unbranded leather",
    stock: 2,
    sold30d: 23,
    rating: 4.9,
    reviewCount: 45,
    garments: ["bag", "bag", "bag", "bag"],
    colors: ["#7a3e1d", "#a8683a", "#3a2a22", "#8b2d2d"],
    bg: "#efe7dc",
    description: [
      "Twelve real-leather shoulder and baguette bags. Conditioned and cleaned inside and out.",
      "Grade A: straps and hardware intact.",
    ],
    reviews: [{ author: "Maya C.", platform: "Depop seller", rating: 5, text: "Best bundle I've bought. Every bag sold.", date: "2026-09-08" }],
  },
  {
    id: "denim-shorts",
    name: "Cut-off denim shorts",
    category: "denim",
    supplier: "seventh",
    price: 9900,
    was: null,
    pieces: 30,
    weightKg: 9,
    grade: "A/B",
    era: "90s–Y2K",
    sizes: "UK 6–16",
    brands: "Mixed high-street",
    stock: 18,
    sold30d: 34,
    rating: 4.3,
    reviewCount: 58,
    garments: ["shorts", "shorts", "shorts", "shorts"],
    colors: ["#6d8fb8", "#3b5a85", "#a9bfd8", "#243b5c"],
    bg: "#e6e2d8",
    description: ["Thirty cut-off and long denim shorts. Light washes, some distressing.", "Grade A/B."],
    reviews: [{ author: "Ella J.", platform: "Vinted seller", rating: 4, text: "Good summer stock, a bit late in the season.", date: "2026-08-20" }],
  },
  {
    id: "college-sweatshirts",
    name: "College & varsity sweatshirts",
    category: "sportswear",
    supplier: "lakeshore",
    price: 22900,
    was: 26900,
    pieces: 24,
    weightKg: 15,
    grade: "A/B",
    era: "90s",
    sizes: "M–XXL",
    brands: "US college and club prints",
    stock: 6,
    sold30d: 66,
    rating: 4.7,
    reviewCount: 118,
    garments: ["hoodie", "knit", "hoodie", "knit"],
    colors: ["#8b2d2d", "#1d2d5a", "#9a9a9a", "#1b5e3b"],
    bg: "#e8e5de",
    description: ["Twenty-four crew and hooded sweatshirts with US college and varsity prints.", "Grade A/B: light cracking on some prints."],
    reviews: [{ author: "Noah G.", platform: "eBay seller", rating: 5, text: "Varsity prints always sell. Great bundle.", date: "2026-09-03" }],
  },
  {
    id: "mixed-reseller-starter",
    name: "Reseller starter mix",
    category: "tees",
    supplier: "northgate",
    price: 6900,
    was: 8900,
    pieces: 20,
    weightKg: 8,
    grade: "B",
    era: "Mixed",
    sizes: "S–XL",
    brands: "Mixed",
    stock: 22,
    sold30d: 95,
    rating: 4.2,
    reviewCount: 312,
    garments: ["tee", "jeans", "knit", "cap"],
    colors: ["#8b2d2d", "#3b5a85", "#d9b36c", "#2f4f3a"],
    bg: "#e9e4da",
    description: [
      "A low-risk first order: twenty mixed pieces across tees, denim, knitwear and caps so you can test what sells in your shop.",
      "Grade B: expect small faults. Priced so each piece costs under £3.50.",
    ],
    reviews: [{ author: "Aisha N.", platform: "New reseller", rating: 4, text: "Perfect for my first month on Vinted.", date: "2026-09-14" }],
  },
];

export const bundleById = (id: string) => BUNDLES.find((b) => b.id === id);
export const supplierById = (id: string) => SUPPLIERS.find((s) => s.id === id);
export const categoryById = (id: string) => CATEGORIES.find((c) => c.id === id);

export function sortBundles(list: Bundle[], sort: string): Bundle[] {
  const out = [...list];
  if (sort === "bestselling") out.sort((a, b) => b.sold30d - a.sold30d);
  else if (sort === "price-asc") out.sort((a, b) => a.price - b.price);
  else if (sort === "rating") out.sort((a, b) => b.rating - a.rating);
  return out;
}

/** Per-piece price, pence. */
export const perPiece = (b: Bundle) => Math.round(b.price / b.pieces);
export const discountPct = (b: Bundle) => (b.was ? Math.round((1 - b.price / b.was) * 100) : 0);
