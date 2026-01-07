/******************************************************************
 * server.js — FULL SINGLE FILE BACKEND
 ******************************************************************/

/* ===================== ENV ===================== */
require("dotenv").config();

/* ===================== DEPENDENCIES ===================== */
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { GoogleGenerativeAI } = require("@google/generative-ai");

/* ===================== APP ===================== */
const app = express();
app.use(express.json());
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

/* ===================== DATABASE ===================== */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ DB Connected"))
  .catch((err) => {
    console.error("❌ DB Connection Failed:", err.message);
    process.exit(1);
  });

/* ===================== MODELS ===================== */
const Seller = mongoose.model(
  "Seller",
  new mongoose.Schema({
    name: String,
    email: String,
    password: String,
    role: { type: String, default: "owner" },
    shopId: mongoose.Schema.Types.ObjectId
  })
);

const Product = mongoose.model(
  "Product",
  new mongoose.Schema({
    sellerId: mongoose.Schema.Types.ObjectId,
    name: String,
    category: String,
    unit: String,
    price: Number,
    stock: Number,
    threshold: { type: Number, default: 5 }
  })
);

const Order = mongoose.model(
  "Order",
  new mongoose.Schema({
    sellerId: mongoose.Schema.Types.ObjectId,
    items: Array,
    total: Number,
    status: { type: String, default: "PENDING" },
    createdAt: { type: Date, default: Date.now }
  })
);

const Invoice = mongoose.model(
  "Invoice",
  new mongoose.Schema({
    sellerId: mongoose.Schema.Types.ObjectId,
    customerName: String,
    items: Array,
    total: Number,
    createdAt: { type: Date, default: Date.now }
  })
);

const Customer = mongoose.model(
  "Customer",
  new mongoose.Schema({
    sellerId: mongoose.Schema.Types.ObjectId,
    name: String,
    phone: String
  })
);

/* ===================== AUTH MIDDLEWARE ===================== */
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ msg: "No token" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ msg: "Invalid token" });
  }
}

/* ===================== AUTH APIs ===================== */
app.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  const hashed = await bcrypt.hash(password, 10);
  const seller = await Seller.create({ name, email, password: hashed });

  const token = jwt.sign({ id: seller._id }, process.env.JWT_SECRET);
  res.json({ token, seller });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const seller = await Seller.findOne({ email });

  if (!seller) return res.status(400).json({ msg: "Invalid credentials" });

  const match = await bcrypt.compare(password, seller.password);
  if (!match) return res.status(400).json({ msg: "Invalid credentials" });

  const token = jwt.sign({ id: seller._id }, process.env.JWT_SECRET);
  res.json({ token, seller });
});

/* ===================== DASHBOARD ===================== */
app.get("/dashboard/stats", auth, async (req, res) => {
  const sellerId = req.user.id;
  res.json({
    totalProducts: await Product.countDocuments({ sellerId }),
    totalOrders: await Order.countDocuments({ sellerId }),
    lowStock: await Product.countDocuments({
      sellerId,
      stock: { $lte: 5 }
    })
  });
});

/* ===================== INVENTORY ===================== */
app.post("/inventory", auth, async (req, res) => {
  const product = await Product.create({
    ...req.body,
    sellerId: req.user.id
  });
  res.json(product);
});

app.get("/inventory", auth, async (req, res) => {
  const products = await Product.find({ sellerId: req.user.id });
  res.json(products);
});

/* ===================== ORDERS ===================== */
app.post("/orders", auth, async (req, res) => {
  const order = await Order.create({
    ...req.body,
    sellerId: req.user.id
  });
  res.json(order);
});

app.get("/orders", auth, async (req, res) => {
  const orders = await Order.find({ sellerId: req.user.id });
  res.json(orders);
});

/* ===================== BILLING ===================== */
app.post("/billing/invoice", auth, async (req, res) => {
  const invoice = await Invoice.create({
    ...req.body,
    sellerId: req.user.id
  });
  res.json(invoice);
});

/* ===================== CUSTOMERS ===================== */
app.post("/customers", auth, async (req, res) => {
  const customer = await Customer.create({
    ...req.body,
    sellerId: req.user.id
  });
  res.json(customer);
});

/* ===================== GEMINI AI ===================== */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL });

app.post("/ai/command", auth, async (req, res) => {
  try {
    const prompt = `
Convert this shop command to JSON intent.
Command: "${req.body.command}"

Allowed intents:
ADD_PRODUCT

Return JSON only.
`;

    const result = await gemini.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    if (parsed.intent === "ADD_PRODUCT") {
      const product = await Product.create({
        ...parsed.data,
        sellerId: req.user.id
      });
      return res.json(product);
    }

    res.json({ msg: "Unknown command" });
  } catch (err) {
    res.status(500).json({ error: "AI failed" });
  }
});

/* ===================== START SERVER ===================== */
app.get("/", (req, res) => {
  res.send("Vyaapar Backend is running 🚀");
});

app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on port ${process.env.PORT}`);
});
