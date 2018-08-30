const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.load();

mongoose.connect(process.env.MLAB_URI || 'mongodb://localhost/exercise-track');

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

// in retrospect breaking up user and log into seperate collections would have made filtering on the db side easier
const exerciseSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  log: [{
    description: { type: String, required: true },
    duration: { type: Number, required: true },
    date: Date
  }]
});

exerciseSchema.post('save', (err, doc, next) => {
  if (err.name === 'MongoError' && err.code === 11000) {
    next(new Error('username already taken'));
  } else {
    next(err);
  }
});

const Exercise = mongoose.model("Exercise", exerciseSchema);

app.post("/api/exercise/new-user", (req, res, next) => {
  Exercise.create({ username: req.body.username })
    .then(result => res.send({ username: result.username, _id: result._id }))
    .catch(next);
});

app.post("/api/exercise/add", (req, res, next) => {
  let date;
  if (req.body.date) {
    date = new Date(req.body.date);
  } else {
    // this will set the date based on the server, not the local user
    date = new Date();
  }

  const exercise = { description: req.body.description, duration: req.body.duration, date };
  Exercise.findByIdAndUpdate(req.body.userId,
    { $push: { log: exercise } },
    { new: true, upsert: true, lean: true })
    .then(result => {
      exercise._id = result._id;
      exercise.date = exercise.date.toDateString();
      res.send(exercise);
    })
    .catch(next);
});

app.get("/api/exercise/log", (req, res, next) => {
  if (!req.query.userId) {
    next(new Error("unknown userId"));
  }

  const query = Exercise.findOne({ _id: req.query.userId });

  if (req.query.limit) {
    query.limit(req.query.limit);
  }

  query.lean().exec()
    .then(result => {
      delete result.__v;

      if (req.query.limit) {
        result.log = result.log.splice(0, req.query.limit);
      }

      result.log = result.log
        .filter(({ date }) => {
          let { from, to } = req.query;
          if (from && to) {
            return date >= new Date(from) && date <= new Date(to);
          } else if (from) {
            return date >= new Date(from);
          } else if (to) {
            return date <= new Date(to);
          }
          return true;
        })
        .map(({ description, duration, date }) => {
          return { description, duration, date: date.toDateString() }
        });

      result.count = result.log.length;
      res.send(result);
    })
    .catch(next);
});

// Not found middleware
app.use((req, res, next) => {
  return next({ status: 404, message: 'not found' });
})

// Error Handling middleware
app.use((err, req, res, next) => {
  let errCode, errMessage;

  if (err.errors) {
    // mongoose validation error
    errCode = 400; // bad request
    const keys = Object.keys(err.errors);
    // report the first validation error
    errMessage = err.errors[keys[0]].message;
  } else {
    // generic or custom error
    errCode = err.status || 500;
    errMessage = err.message || 'Internal Server Error';
  }
  res.status(errCode).type('txt')
    .send(errMessage);
});

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});
