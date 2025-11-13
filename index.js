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
    // await client.connect();
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
      const newInterest = { _id: new ObjectId(), interestId, ...interest };

      await cropsCollection.updateOne(
        { _id: new ObjectId(cropId) },
        { $push: { interests: newInterest } }
      );

      const updatedCrop = await cropsCollection.findOne({
        _id: new ObjectId(cropId),
      });
      res.send(updatedCrop);
    });

    // add patch for accept/reject crops for owner
    app.patch(
      "/crops/:cropId/interests/:interestId",
      verifyFireBaseToken,
      async (req, res) => {
        const { cropId, interestId } = req.params;
        const { action } = req.body;

        if (!["accepted", "rejected"].includes(action)) {
          return res.status(400).send({ message: "Invalid action" });
        }

        try {
          const crop = await cropsCollection.findOne({
            _id: new ObjectId(cropId),
          });
          if (!crop) return res.status(404).send({ message: "Crop not found" });

          if (req.user.email !== crop.owner.ownerEmail)
            return res.status(403).send({ message: "Forbidden: Not owner" });

          const interestIndex = crop.interests.findIndex(
            (i) => i._id.toString() === interestId
          );
          if (interestIndex === -1)
            return res.status(404).send({ message: "Interest not found" });

          crop.interests[interestIndex].status = action;

          if (action === "accepted") {
            crop.quantity -= crop.interests[interestIndex].quantity;
            if (crop.quantity < 0) crop.quantity = 0;
          }

          await cropsCollection.updateOne(
            { _id: new ObjectId(cropId) },
            { $set: { interests: crop.interests, quantity: crop.quantity } }
          );

          res.send(crop);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update interest" });
        }
      }
    );

    // get interested crops of a user
    app.get("/my-interests", verifyFireBaseToken, async (req, res) => {
      const email = req.query.email;
      const allCrops = await cropsCollection.find().toArray();

      const userInterests = allCrops.flatMap((crop) =>
        (crop.interests || [])
          .filter((i) => i.userEmail === email)
          .map((i) => ({
            _id: i._id,
            cropId: crop._id,
            cropName: crop.cropName || crop.name || "Unknown",
            ownerName: crop.owner.ownerName || "Unknown",
            ownerEmail: crop.owner.ownerEmail || "Unknown",
            quantity: i.quantity,
            message: i.message,
            status: i.status || "pending",
          }))
      );

      res.send(userInterests);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
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
