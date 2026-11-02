# Appendix A. PrintMine.in analysis (summary)

> Part of the [DUIS Printworks plan](README.md). § numbers refer to [development-plan.md](development-plan.md).

**What was checked:**
- Live pages and the public catalogue feed (38 products, every variant and price).
- 16 pages and 3 collections from the sitemaps.
- The FAQ, policies, contact and tracking pages.
- The design-studio script.

The checkout and signed-in account pages were not entered; how they work is taken from the FAQ.

**The business:**
- HK Enterprises, Raipur, trading since 2019. Makes everything in its own factory.
- Claims 81,000+ orders and 4.4★ from about 3,300 reviews.
- Built on Shopify, with Shiprocket's Fastrr checkout (phone-OTP sign-in).
- Review apps: Judge.me and Loox. Factory video through Whatmore.

**The customer journey:**
1. Discover (home page, best sellers).
2. Free "Preview your logo" tool:
   - one logo on every product, Indic fonts, background removal, engraving and sublimation looks;
   - built on fabric.js 5.3.1 with pdf.js; about 930 KB of script.
3. Product page:
   - variant plus a **quantity slab faked as a variant**;
   - size mix typed into free-text fields;
   - either the do-it-yourself studio, or "upload your logo and our designer prepares it" (PNG, JPG, PDF, AI, CDR, SVG, up to 20 MB);
   - a text note; artwork can also be sent on WhatsApp later.
4. Cart, with a FIRSTORDER coupon worth 12%.
5. Payment: prepaid (free shipping), or partial COD (advance online plus a fee). Some products are flagged NOCOD.
6. The proof arrives **on WhatsApp after the order**, and approval happens outside the site.
7. In-house production; dispatch within 24–48 hours of approval. Couriers: Delhivery, Blue Dart, DTDC, Xpressbees, India Post.
8. Tracking by order number, or by AWB with the courier detected automatically.
9. Cancellation within 2 working hours only. No returns. Damage claims within 48 hours, with an uncut unboxing video.
10. Customers add their own GSTIN to the invoice in their account. GST rates:
    - garments 5% up to ₹2,500 per piece, 18% above;
    - gifts and printing services 18%.

**Pricing examples:** the per-piece price falls with quantity.
- Polo: ₹724.50 at 2 pieces → ₹410 at 76–100.
- Caps: ₹278 → ₹152.
- Metal keychain: ₹699 → ₹304.

MOQs run from 2 to 100 pieces. Bulk orders are done by written quote plus a purchase order, offline.

**Gaps that Printworks fixes:**
- Slabs faked as variants.
- Approvals off the record.
- No quotes or company details in the app.
- No visible production progress.
- Designs saved only in the browser.
- Inconsistent claims on the site.
