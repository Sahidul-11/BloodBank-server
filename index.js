const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId, Db } = require('mongodb')
const stripe = require("stripe")(process.env.STIPE_SECRECT)
const jwt = require('jsonwebtoken')

const port = process.env.PORT || 8000;

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

// Verify Token
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.90yxez6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    //db collection 
    const divisionsCollection = client.db("BloodBank").collection("Division")
    const districtCollection = client.db("BloodBank").collection("district")
    const upazilaCollection = client.db("BloodBank").collection("upazilla")
 
    const userCollection = client.db("BloodBank").collection("user")
    const donationReqCollection = client.db("BloodBank").collection("DonationReq")
    const BlogsCollection = client.db("BloodBank").collection("Blogs")
    const fundsCollection = client.db("BloodBank").collection("funds")

    // verify admin 
  const verifyAdmin = async (req, res, next) => {
    const user = req.user
    const query = { email: user?.email }
    const result = await userCollection.findOne(query)
    if (!result || result?.role !== 'admin')
      return res.status(401).send({ message: 'unauthorized access!!' })

    next()
  }
  // verify host 
  const verifyBoth = async (req, res, next) => {
    const user = req.user
    const query = { email: user?.email }
    const result = await userCollection.findOne(query)
    if (!result) {
      return res.status(401).send({ message: 'unauthorized access!!' })
    }
    else if (result?.role === 'admin' || result?.role === 'volunteer') {
      next()
    } 
    else{
      return res.status(401).send({ message: 'unauthorized access!!' })
    } 
  }


    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })
    // stripe
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const IntPice = parseFloat(price) * 100;
      if (!IntPice || IntPice < 1) {
        return
      }
      const paymentIntent = await stripe.paymentIntents.create({
        amount: IntPice,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      })
      res.send({ clientSecret: paymentIntent.client_secret})

    })
    //fund collection
    app.post('/funding',verifyToken, async(req ,res)=>{
      const paymentInfo=req.body.paymentInfo
      const result = await fundsCollection.insertOne(paymentInfo)
      res.send(result)
    })
    app.get('/funding/:email', verifyToken, async(req ,res)=>{
      const email = req.params.email
      const result = await fundsCollection.find({ email }).sort({ date: -1 }).limit(15).toArray()
      res.send(result)
    })
  
    //District ,thana
    app.get("/division", async (req, res) => {
      const result = await divisionsCollection.find().toArray()
      res.send(result)

    })
    app.get("/district/:id", async (req, res) => {
      const id = req.params.id;
      const query = { division_id: id }
      const result = await districtCollection.find(query).toArray()
      res.send(result)

    })
    app.get("/upazila/:id", async (req, res) => {
      const id = req.params.id;
      const query = { district_id: id }
      const result = await upazilaCollection.find(query).toArray()
      res.send(result)

    })
    //get panel
    app.get("/panel",verifyToken , verifyBoth , async (req , res)=>{
      const funds = await fundsCollection.find({},{
        projection :{
          amount : 1
        }
      }).toArray()
      const totalFund = funds.reduce((sun ,fund)=> sun + parseInt(fund.amount) ,0)
      const users = await userCollection.estimatedDocumentCount()
      const donationRequests=await donationReqCollection.estimatedDocumentCount()
      res.send({totalFund ,users ,donationRequests})
    })
    //create blogs
    app.post("/Blogs",verifyToken,verifyBoth, async (req, res) => {
      const blog = req.body
      const result = await BlogsCollection.insertOne(blog)
      res.send(result)
    })
    //get blogs
    app.get("/blogs", async (req, res) => {
      let query = {}
      const status = req?.query?.status
      if (status === "draft") {
        query = { status: false }
      }
      if (status === "publish") {
        query = { status: true }
      }
      const result = await BlogsCollection.find(query).toArray()
      res.send(result)
    })
    //publish
    app.patch("/blogs/:id", verifyToken,verifyAdmin, async (req, res) => {
      const id = req.params.id
      const { status } = req.body
      const filter = { _id: new ObjectId(id) }
      const result = await BlogsCollection.updateOne(filter, { $set: { status: !status } })
      res.send(result)
    })
    app.delete("/blogs/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const result = await BlogsCollection.deleteOne(filter)
      res.send(result)
    })
    app.get("/blogs/:id", verifyToken, async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const result = await BlogsCollection.findOne(filter)
      res.send(result)
    })
    //  create user

    app.post("/user", async (req, res) => {
      const user = req.body;
      const email = user?.email;
      const isExist = await userCollection.findOne({ email: email })
      if (isExist) {
        return
      }
      const result = await userCollection.insertOne(user)
      res.send(result)
    })
    // search Donor 
    app.get("/Search", async (req, res) => {
      const data = req.query
      const filter = {
        ...data
      }
      const result = await userCollection.find(filter).toArray()
      res.send(result)
    })
    //get all user
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const sort = req.query.sort
      console.log(sort)
      let filter = {}
      if (sort === "true") {
        filter = { status: true }
      }
      if (sort === "false") {
        filter = { status: false }
      }

      const result = await userCollection.find(filter).toArray()
      res.send(result)
    })
    //top user
    app.get("/topUser", async(req,res)=>{
      const result = await userCollection.find().limit(6).toArray()
      res.send(result)
    })
    // get a user by email
    app.get("/user/:email",verifyToken, async (req, res) => {
      const email = req.params.email
      const query = { email: email }
      const result = await userCollection.findOne(query)
      res.send(result)
    })
    app.put("/user/:email", verifyToken, async (req, res) => {
      const user = req.body;
      const email = req.params.email
      const isStatus = req.query.status;
      const role = req.query.role;
      const query = { email: email }
      const options = { upsert: true };
      if (role && role !== "null" && role !== "undefined") {
        const result = await userCollection.updateOne(query, { $set: { role: role } }, options)
        return res.send(result)
      }
      if (isStatus) {
        const AUser = await userCollection.findOne(query)
        const result = await userCollection.updateOne(query, { $set: { status: !AUser?.status } }, options)
        return res.send(result)
      }
      const updateDoc = {
        $set: {
          name: user?.name,
          avatar: user?.avatar,
          BloodGroup: user?.BloodGroup,
          division: user?.division,
          district: user?.district,
          upazila: user?.upazila,
        }
      }
      const result = await userCollection.updateOne(query, updateDoc, options)
      res.send(result)
    })
    // donation req create
    app.put("/donationReq", verifyToken, async (req, res) => {
      const Request = req.body;
      const id = req.query.id
      const options = { upsert: true };
      Request.timestamp = new Date();
      if (id && id !== "null" && id !== "undefined") {
        const result = await donationReqCollection.updateOne({ _id: new ObjectId(id) }, { $set: { ...Request } }, options)

        return res.send(result)
      }
      const result = await donationReqCollection.insertOne(Request)
      res.send(result)
    })
    app.put("/donate/:id", verifyToken, async (req, res) => {
      const id = req.params.id
      const Donor = req.body
      const options = { upsert: true };
      const filter = { _id: new ObjectId(id) }
      const result = await donationReqCollection.updateOne(filter, { $set: { status: "inprogress", donor: Donor } }, options)
      res.send(result)

    })
    //get all donation requests
    app.get("/donationReq/:email", verifyToken, async (req, res) => {
      const email = req.params.email
      const query = { requesterEmail: email }
      const result = await donationReqCollection.find(query).toArray()
      res.send(result)
    })
    //grt Recent 3 data
    app.get("/recent/:email", verifyToken, async (req, res) => {
      const email = req.params.email

      const result = await donationReqCollection.find({ requesterEmail: email }).sort({ timestamp: -1 }).limit(3).toArray()
      res.send(result)
    })
    app.get("/allRequest", verifyToken, verifyBoth, async (req, res) => {
      let query = {}
      const status = req?.query?.status
      if (status && status !== "null" && status !== "undefined") {
        query = { status }
      }

      const result = await donationReqCollection.find(query).toArray()
      res.send(result)
    })
    // get pending request
    app.get("/pendingReq", async (req, res) => {
      const result = await donationReqCollection.find({ status: "pending" }).toArray()
      res.send(result)
    })
    app.delete("/donationReq/:id", verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await donationReqCollection.deleteOne(query)
      res.send(result)
    })
    app.get("/aDonationReq/:id", verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await donationReqCollection.findOne(query)
      res.send(result)
    })
    app.patch("/donationReq/:email", verifyToken, async (req, res) => {
      const status = req.body.changeStatus
      const id = req?.body?._id
      const email = req.params.email
      const query = { requesterEmail: email, _id: new ObjectId(id) }
      const options = { upsert: true };
      const result = await donationReqCollection.updateOne(query, { $set: { status } }, options)
      res.send(result)
    })
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from BloodBank Server..')
})

app.listen(port, () => {
  console.log(`BloodBank is running on port ${port}`)
})
