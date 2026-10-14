
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to MediFind Backend API",
    status: "Running"
  });
});

// Temporary demo data
const users = [];
const shops = [];
const medicines = [
  {
    id: 1,
    name: "Paracetamol",
    price: 25,
    shop: "Sri Medical Store",
    location: "Puttaparthi",
    available: true
  },
  {
    id: 2,
    name: "Cetirizine",
    price: 15,
    shop: "City Medical Store",
    location: "Puttaparthi",
    available: true
  }
];

// User registration
app.post("/api/users/register", (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      message: "Name, email and password are required"
    });
  }

  if (users.some(user => user.email === email)) {
    return res.status(409).json({
      message: "Email already registered"
    });
  }

  // Demo only: never store plaintext passwords in production.
  users.push({ id: users.length + 1, name, email, password });

  res.status(201).json({
    message: "User registered successfully"
  });
});

// Medical shop owner registration
app.post("/api/shops/register", (req, res) => {
  const { ownerName, shopName, email, location } = req.body;

  if (!ownerName || !shopName || !email || !location) {
    return res.status(400).json({
      message: "Please provide all required shop details"
    });
  }

  shops.push({
    id: shops.length + 1,
    ownerName,
    shopName,
    email,
    location
  });

  res.status(201).json({
    message: "Medical shop registered successfully"
  });
});

// Demo login endpoint
app.post("/api/login", (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({
      message: "Email, password and role are required"
    });
  }

  const records = role === "user" ? users
    : role === "shop" ? shops : null;

  if (!records) {
    return res.status(400).json({
      message: "Role must be user or shop"
    });
  }

  const account = records.find(record =>
    record.email === email && record.password === password
  );

  if (!account) {
    return res.status(401).json({
      message: "Invalid email or password"
    });
  }

  // Demo only: implement password hashing and secure
  // session/JWT authentication before production use.
  res.json({
    message: "Login successful",
    role
  });
});

// Search medicines
app.get("/api/medicines/search", (req, res) => {
  const name = (req.query.name || "").trim();

  if (!name) {
    return res.status(400).json({
      message: "Please enter a medicine name"
    });
  }

  const results = medicines.filter(medicine =>
    medicine.name.toLowerCase().includes(name.toLowerCase()) &&
    medicine.available
  );

  res.json({
    count: results.length,
    medicines: results
  });
});

// Get all registered demo shops
app.get("/api/shops", (req, res) => {
  res.json(shops);
});

// Start server
app.listen(PORT, () => {
  console.log(`MediFind backend running on port ${PORT}`);
});
