const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const serviceAccount = require("./service_admin_sdk.json");

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFireBaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).send({ message: "Unauthorized: Missing token" });
  }

  // verify id token
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // user info available in req.user
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(403).send({ error: "Forbidden: Invalid token" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.byizzgz.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("AgroNet Backend is running...!");
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("AgroNet_DB");
    const cropsCollection = db.collection("crops");

    // get all crops
    app.get("/crops", async (req, res) => {
      try {
        const crops = await cropsCollection.find().toArray();
        console.log("Fetched crops:", crops); // Add this
        res.send(crops);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch crops" });
      }
    });

    // get latest 6 crops
    app.get("/latest-crops", async (req, res) => {
      const cursor = cropsCollection.find().sort({ created_at: -1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get single crop detail
    app.get("/crops/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cropsCollection.findOne(query);
      res.send(result);
    });

    // create new crop
    app.post("/crops", verifyFireBaseToken, async (req, res) => {
      const crop = req.body;
      crop.created_at = new Date();
      if (crop.ownerEmail && crop.ownerName) {
        crop.owner = {
          ownerEmail: crop.ownerEmail,
          ownerName: crop.ownerName,
        };
      }
      const result = await cropsCollection.insertOne(crop);
      res.send(result);
    });

    // get crops of logged in user
    app.get("/my-crops", verifyFireBaseToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.ownerEmail = email;
      }
      const cursor = cropsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // Update crops by Id
    app.put("/crops/:id", async (req, res) => {
      const id = req.params.id;
      const updates = req.body;
      const result = await cropsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updates }
      );
      res.send(result);
    });

    // delete crop
    app.delete("/crops/:id", verifyFireBaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await cropsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // add interest to a crop
    app.post("/crops/:id/interests", verifyFireBaseToken, async (req, res) => {
      const cropId = req.params.id;
      const interest = req.body;
      const interestId = new ObjectId();
      const newInterest = { _id: interestId, ...interest };

      await cropsCollection.updateOne(
        { _id: new ObjectId(cropId) },
        { $push: { interests: newInterest } }
      );

      const updatedCrop = await cropsCollection.findOne({
        _id: new ObjectId(cropId),
      });
      res.send(updatedCrop);
    });

    // get interested crops of a user
    app.get("/my-interests", async (req, res) => {
      const email = req.query.email;
      const allCrops = await cropsCollection.find().toArray();

      const userInterests = [];

      allCrops.forEach((crop) => {
        if (crop.interests && Array.isArray(crop.interests)) {
          crop.interests.forEach((interest) => {
            if (interest.userEmail === email) {
              userInterests.push({
                _id: interest._id,
                cropName: crop.cropName || crop.name || "Unknown",
                ownerName: crop.ownerName || "Unknown",
                ownerEmail: crop.ownerEmail || "Unknown",
                quantity: interest.quantity,
                message: interest.message,
                status: interest.status || "pending",
              });
            }
          });
        }
      });
      res.send(userInterests);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
