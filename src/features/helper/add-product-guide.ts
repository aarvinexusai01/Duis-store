/**
 * "How to add a product": the complete written guide. The admin help page
 * (/admin/help/add-product) and the printable copy are both made from this,
 * so they always say the same thing. Button and field names match the admin
 * exactly; keep them in step when the screens change.
 */

export type GuideStep = {
  title: string
  body: string
  /** Where in the admin this happens. */
  where?: { label: string; href: string }
}

export type GuideSection = {
  id: string
  title: string
  intro: string
  steps: GuideStep[]
  tip?: string
}

export const ADD_PRODUCT_GUIDE: {
  title: string
  intro: string
  sections: GuideSection[]
} = {
  title: "How to add a product",
  intro:
    "Everything from an empty shop to a product customers can buy. Part 1 is done once; parts 2 to 6 are done for every product. Miso the cat can also walk you through parts 2 to 5 on screen.",
  sections: [
    {
      id: "setup",
      title: "1. Before your first product",
      intro:
        "Do these once. After that, every new product just picks from them.",
      steps: [
        {
          title: "Make the category",
          body: "In Categories, press '+ Top-level category' for a main one (like T-Shirts), or the + on a row to add one inside it (like Oversized T-Shirts). Give it a name and its HSN code (6109 for T-shirts, 6110 for hoodies and sweatshirts); products inherit the code.",
          where: { label: "Categories", href: "/admin/categories" },
        },
        {
          title: "Make the size chart",
          body: "In Size charts, press 'New size chart', name it (like 'Oversized tees'), add a column per measurement (Chest, Length, Shoulder) and a row per size, then 'Create chart'.",
          where: { label: "Size charts", href: "/admin/size-charts" },
        },
        {
          title: "Attach the chart to the category",
          body: "Back in Categories, press the pencil on the category and choose the chart under 'Size chart'. Every product in that category, and in categories inside it, shows that chart.",
          where: { label: "Categories", href: "/admin/categories" },
        },
        {
          title: "Check your colours and sizes",
          body: "In Attributes, Colour and Size list what products can use. Add a missing one under 'New value'. For a colour, pick its swatch and filter group (all blues show as one 'Blue' filter in the shop). You can also add one later with '+ Add new' while generating variants.",
          where: { label: "Attributes", href: "/admin/attributes" },
        },
      ],
      tip: "Not sure it's set up? Open New product: if your category is listed under Categories, you're ready.",
    },
    {
      id: "details",
      title: "2. The product's details",
      intro:
        "Products → New product. Only the details here; photos and sizes come after you save.",
      steps: [
        {
          title: "Title",
          body: "The name customers see, like 'Samurai Spirit Graphic Hoodie – Beige'. The URL slug (the web address) fills itself in; change it only if you need to.",
          where: { label: "New product", href: "/admin/products/new" },
        },
        {
          title: "Categories",
          body: "Tick the most specific category first (Hoodies, not Hoodies & Sweatshirts). The first one ticked is the main category: it sets the breadcrumbs and the size chart.",
        },
        {
          title: "Variant options: Colour, then Size",
          body: "Tick Colour first, then Size: customers pick a colour, then their size. These can't be changed after the product is created, so check before saving.",
        },
        {
          title: "Description and specifications",
          body: "Describe the fabric, fit and feel. Add specifications as name and value pairs, like Fabric: 100% cotton, 240 GSM. Material and Care show on the product page too.",
        },
        {
          title: "Fit, sleeve and pattern",
          body: "Tick the values that apply. They become filters in the shop, so customers can find all oversized or all graphic pieces.",
        },
        {
          title: "Legal and shipping",
          body: "Manufacturer / packer is required by law (name and address). Weight is the packed weight in grams; the courier charges by it. Leave HSN code empty to use the category's.",
        },
        {
          title: "Search engines (optional)",
          body: "An SEO title (up to 70 characters) and description (up to 170) for Google. Left empty, the title and description are used.",
        },
        {
          title: "Create product",
          body: "Press 'Create product'. It's saved as a draft, which customers can't see yet.",
        },
      ],
    },
    {
      id: "variants",
      title: "3. Sizes, prices and stock",
      intro:
        "On the product, open the 'Variants & stock' tab. Do this before photos, so photos can be tagged by colour.",
      steps: [
        {
          title: "Generate variants",
          body: "Under 'Generate variants', tick each colour and size you sell. Missing one? Use '+ Add new' right in the list. One variant is made for every colour and size ticked.",
        },
        {
          title: "Price, MRP and starting stock",
          body: "Enter the selling price and the MRP (the MRP can't be lower than the price), and how many of each you have in 'Starting stock each'. The SKU prefix fills itself in from the name; keep it short and unique, like SAMURAI-BEIGE.",
        },
        {
          title: "Press 'Create up to … variants'",
          body: "The variants appear in the table. To give one size a different price, change it in its row and press 'Save changes'. 'Fill every row' sets one price for all of them.",
        },
        {
          title: "Adjust stock",
          body: "Press 'Stock' on a row to add or remove units, and choose why: 'Received new stock' when a delivery arrives. Every change is recorded with your name.",
        },
      ],
    },
    {
      id: "photos",
      title: "4. Photos",
      intro: "Open the 'Photos' tab.",
      steps: [
        {
          title: "Upload photos",
          body: "Press 'Upload photos' and choose several at once. JPG, PNG, WebP or AVIF, up to 15 MB each. Portrait 4:5 looks best, such as 1200 × 1500 pixels.",
        },
        {
          title: "Order them",
          body: "The first photo is the main photo, shown in listings. Use 'Move earlier' and 'Move later' to change the order.",
        },
        {
          title: "Tag each photo's colour",
          body: "Under 'Colour', pick the colour each photo shows, so customers see the right photos when they pick a colour. Leave 'All colours' for photos that suit every colour. With only one colour, you can skip this.",
        },
        {
          title: "Alt text",
          body: "A short description of the photo for people using screen readers and for Google, like 'Beige hoodie, back print of a samurai'.",
        },
        {
          title: "Save photos",
          body: "Press 'Save photos'. Uploaded photos aren't attached to the product until you do.",
        },
      ],
    },
    {
      id: "publish",
      title: "5. Check and publish",
      intro:
        "At the top of the product, the 'Ready to sell?' card checks everything for you.",
      steps: [
        {
          title: "Read 'Ready to sell?'",
          body: "'Must fix' items stop the product being published: it needs at least one photo and one size. 'Suggested' items (no stock, a colour without its own photo, no description, no size chart) won't stop you, but fix them if you can. Each has a button that takes you to the fix.",
        },
        {
          title: "Publish",
          body: "Press 'Publish'. The product is in the shop straight away and appears in search and its categories.",
        },
        {
          title: "View in store",
          body: "Press 'View in store' to open it as customers see it. Check the photos for each colour, the sizes and the size guide.",
        },
      ],
    },
    {
      id: "after",
      title: "6. After publishing",
      intro: "Optional, but it helps customers find the product.",
      steps: [
        {
          title: "Add it to a collection",
          body: "In Collections, open one (like Best Sellers) and use 'Search products to add'. Automatic collections, like New Arrivals, add matching products by themselves. Collections show on the home page.",
          where: { label: "Collections", href: "/admin/collections" },
        },
        {
          title: "Restock later",
          body: "When a delivery arrives, use Inventory: press 'Adjust' on the size and choose 'Received new stock'. The dashboard's Today list warns you about sizes running low or sold out.",
          where: { label: "Inventory", href: "/admin/inventory" },
        },
        {
          title: "A similar product",
          body: "On a product, 'Duplicate' copies its details, categories and photos as a new draft with a new web address (not its sizes or stock). Change the name, generate its variants, then publish.",
        },
        {
          title: "Stop selling it",
          body: "'Archive' takes a product out of the shop. Its past orders are kept.",
        },
      ],
    },
  ],
}
