
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err.message));

// ---------------- MODELS ----------------

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "shop"],
      required: true
    }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

const shopSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: {
        type: [Number],
        required: true
      }
    }
  },
  { timestamps: true }
);

shopSchema.index({ location: "2dsphere" });

const Shop = mongoose.model("Shop", shopSchema);

const medicineSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true
    },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 0 },
    description: { type: String, default: "" }
  },
  { timestamps: true }
);

medicineSchema.index({ name: "text" });

const Medicine = mongoose.model("Medicine", medicineSchema);

// ---------------- AUTHENTICATION ----------------

function createToken(user) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Please log in first" });
  }

  try {
    req.auth = jwt.verify(
      header.split(" ")[1],
      process.env.JWT_SECRET
    );
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function allowRole(role) {
  return (req, res, next) => {
    if (req.auth.role !== role) {
      return res.status(403).json({
        message: "You are not allowed to perform this action"
      });
    }
    next();
  };
}

// ---------------- REGISTER ----------------

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password ||
        !["user", "shop"].includes(role)) {
      return res.status(400).json({
        message: "Name, email, password and valid role are required"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters"
      });
    }

    const existing = await User.findOne({
      email: email.trim().toLowerCase()
    });

    if (existing) {
      return res.status(409).json({
        message: "Email already registered"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role
    });

    res.status(201).json({
      message: "Registration successful",
      token: createToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Email already registered"
      });
    }

    res.status(500).json({ message: "Registration failed" });
  }
});

// ---------------- LOGIN ----------------

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const user = await User.findOne({
      email: (email || "").trim().toLowerCase(),
      role
    });

    if (!user || !(await bcrypt.compare(
      password || "",
      user.password
    ))) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    res.json({
      message: "Login successful",
      token: createToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch {
    res.status(500).json({ message: "Login failed" });
  }
});

// ---------------- SHOP OWNER: ADD SHOP ----------------

// Coordinates must be longitude first, then latitude.
app.post(
  "/api/shops",
  authenticate,
  allowRole("shop"),
  async (req, res) => {
    try {
      const { name, address, phone, longitude, latitude } = req.body;

      if (!name || !address || !phone ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          longitude < -180 || longitude > 180 ||
          latitude < -90 || latitude > 90) {
        return res.status(400).json({
          message: "Provide shop details and valid coordinates"
        });
      }

      const shop = await Shop.findOneAndUpdate(
        { owner: req.auth.id },
        {
          owner: req.auth.id,
          name,
          address,
          phone,
          location: {
            type: "Point",
            coordinates: [longitude, latitude]
          }
        },
        { new: true, upsert: true, runValidators: true }
      );

      res.status(201).json({
        message: "Shop details saved",
        shop
      });
    } catch {
      res.status(500).json({ message: "Could not save shop" });
    }
  }
);

// ---------------- SHOP OWNER: ADD MEDICINE ----------------

app.post(
  "/api/medicines",
  authenticate,
  allowRole("shop"),
  async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.auth.id });

      if (!shop) {
        return res.status(400).json({
          message: "Register your medical shop first"
        });
      }

      const { name, price, quantity, description = "" } = req.body;

      if (
        typeof name !== "string" || !name.trim() ||
        !Number.isFinite(price) || price < 0 ||
        !Number.isInteger(quantity) || quantity < 0
      ) {
        return res.status(400).json({
          message: "Provide medicine name, valid price and quantity"
        });
      }

      const medicine = await Medicine.create({
        shop: shop._id,
        name: name.trim(),
        price,
        quantity,
        description
      });

      res.status(201).json({
        message: "Medicine added successfully",
        medicine
      });
    } catch {
      res.status(500).json({ message: "Could not add medicine" });
    }
  }
);

// ---------------- SHOP OWNER: UPDATE MEDICINE ----------------

app.put(
  "/api/medicines/:id",
  authenticate,
  allowRole("shop"),
  async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.auth.id });

      if (!shop) {
        return res.status(404).json({ message: "Shop not found" });
      }

      const updates = {};
      const { name, price, quantity, description } = req.body;

      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          return res.status(400).json({ message: "Invalid name" });
        }
        updates.name = name.trim();
      }

      if (price !== undefined) {
        if (!Number.isFinite(price) || price < 0) {
          return res.status(400).json({ message: "Invalid price" });
        }
        updates.price = price;
      }

      if (quantity !== undefined) {
        if (!Number.isInteger(quantity) || quantity < 0) {
          return res.status(400).json({ message: "Invalid quantity" });
        }
        updates.quantity = quantity;
      }

      if (description !== undefined) {
        updates.description = description;
      }

      const medicine = await Medicine.findOneAndUpdate(
        { _id: req.params.id, shop: shop._id },
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!medicine) {
        return res.status(404).json({
          message: "Medicine not found in your shop"
        });
      }

      res.json({ message: "Medicine updated", medicine });
    } catch {
      res.status(500).json({ message: "Update failed" });
    }
  }
);

// ---------------- SHOP OWNER: DELETE MEDICINE ----------------

app.delete(
  "/api/medicines/:id",
  authenticate,
  allowRole("shop"),
  async (req, res) => {
    try {
      const shop = await Shop.findOne({ owner: req.auth.id });

      if (!shop) {
        return res.status(404).json({ message: "Shop not found" });
      }

      const medicine = await Medicine.findOneAndDelete({
        _id: req.params.id,
        shop: shop._id
      });

      if (!medicine) {
        return res.status(404).json({
          message: "Medicine not found in your shop"
        });
      }

      res.json({ message: "Medicine deleted" });
    } catch {
      res.status(500).json({ message: "Delete failed" });
    }
  }
);

// ---------------- SEARCH MEDICINES NEARBY ----------------

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) *
    Math.cos(rad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}

app.get("/api/medicines/search", async (req, res) => {
  try {
    const { name, latitude, longitude, radius = "20" } = req.query;

    if (!name || !name.trim()) {
      return res.status(400).json({
        message: "Enter a medicine name"
      });
    }

    const hasLocation =
      latitude !== undefined && longitude !== undefined;

    let lat, lon, maxDistance;

    if (hasLocation) {
      lat = Number(latitude);
      lon = Number(longitude);
      maxDistance = Number(radius);

      if (
        !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lon) || lon < -180 || lon > 180 ||
        !Number.isFinite(maxDistance) ||
        maxDistance <= 0 || maxDistance > 500
      ) {
        return res.status(400).json({
          message: "Invalid location or search radius"
        });
      }
    }

    const filter = {
      name: { $regex: name.trim(), $options: "i" },
      quantity: { $gt: 0 }
    };

    const medicines = await Medicine.find(filter)
      .populate("shop", "name address phone location")
      .limit(500)
      .lean();

    let results = medicines
      .filter((m) => m.shop)
      .map((m) => {
        const [shopLon, shopLat] = m.shop.location.coordinates;

        const distance = hasLocation
          ? distanceKm(lat, lon, shopLat, shopLon)
          : null;

        return {
          id: m._id,
          medicine: m.name,
          price: m.price,
          quantityAvailable: m.quantity,
          description: m.description,
          shop: {
            id: m.shop._id,
            name: m.shop.name,
            address: m.shop.address,
            phone: m.shop.phone,
            latitude: shopLat,
            longitude: shopLon
          },
          distanceKm: distance === null
            ? null
            : Number(distance.toFixed(2))
        };
      });

    if (hasLocation) {
      results = results.filter(
        (m) => m.distanceKm <= maxDistance
      );

      results.sort((a, b) => a.distanceKm - b.distanceKm);
    } else {
      results.sort((a, b) => a.price - b.price);
    }

    res.json({
      count: results.length,
      results
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Medicine search failed" });
  }
});

// ---------------- HEALTH CHECK ----------------

app.get("/", (req, res) => {
  res.json({ message: "MediFind backend is running" });
});

// ---------------- START SERVER ----------------

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`MediFind server running on port ${PORT}`);
});