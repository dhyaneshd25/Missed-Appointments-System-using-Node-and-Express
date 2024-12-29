// Step 1: Set up the project
// Initialize a new Node.js project and install required dependencies
// Command: npm init -y
// Command: npm install express mongoose emailjs-com

const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer')
const cors = require('cors')

const app = express();
app.use(express.json());
app.use(cors())

// Step 2: Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/appointments', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch((error) => console.error('MongoDB connection error:', error));


// Start the server
// command node index.js
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Step 3: Define Mongoose Schemas and Models
const appointmentSchema = new mongoose.Schema({
    patientName: String,
    patientEmail: String,
    doctorId: String,
    appointmentTime: Date,
    status: { type: String, default: 'Scheduled' }, // Possible values: Scheduled, Missed, Rescheduled
});

const doctorSchema = new mongoose.Schema({
    doctorId: { type: String, unique: true, required: true },
    name: String,
    email: String,
    schedule: [
        {
            date: Date,
            availableSlots: [String], // Example: ['10:00', '11:00']
        },
    ],
});

const Appointment = mongoose.model('Appointment', appointmentSchema);
const Doctor = mongoose.model('Doctor', doctorSchema);

// Step 4: Automatic Detection of Missed Appointments
const checkMissedAppointments = async () => {
    const now = new Date();
    const gracePeriod = 15 * 60 * 1000; // 15 minutes in milliseconds

    const missedAppointments = await Appointment.find({
        $or: [
            { status: 'Scheduled' },
            { status: 'Rescheduled' }
          ],
        appointmentTime: { $lte: new Date(now.getTime() - gracePeriod) },
    });

    missedAppointments.forEach(async (appointment) => {
        appointment.status = 'Missed';
        await appointment.save();

        console.log(`Marked appointment as missed: ${appointment.patientName}`);
    });
};
setInterval(checkMissedAppointments, 60 * 1000); // Run every minute



// Step 5: Endpoint to Add a Doctor
app.post('/add-doctor', async (req, res) => {
    try {
        const doctor = new Doctor(req.body);
        await doctor.save();
        res.status(201).send('Doctor added successfully');
    } catch (error) {
        console.error('Error adding doctor:', error);
        if (error.name === 'ValidationError') {
            return res.status(400).send(`Validation Error: ${error.message}`);
        }
        res.status(500).send('Error adding doctor');
    }
});

app.get('/doctors', async (req, res) => {
    try {
        // Retrieve all doctor names from the Doctor collection
        const doctors = await Doctor.find({}, 'name'); // Fetch only the "name" field

        res.status(200).json(doctors); // Send the list of doctor names as a response
    } catch (error) {
        console.error('Error retrieving doctor names:', error);
        res.status(500).send('Error retrieving doctor names');
    }
});


app.put('/update-slots/:doctorId', async (req, res) => {
    const { doctorId } = req.params;  // Doctor's ID from URL
    const { date, newSlots } = req.body;  // New slots to add (date and slots array)

    try {
        // Find the doctor by doctorId
        const doctor = await Doctor.findOne({ doctorId });
        if (!doctor) {
            return res.status(404).send('Doctor not found');
        }

        // Find the schedule entry for the specific date
        const schedule = doctor.schedule.find(day => 
            new Date(day.date).toISOString().split('T')[0] === new Date(date).toISOString().split('T')[0]
        );

        if (!schedule) {
            // If no schedule entry exists for that date, create a new one
            doctor.schedule.push({
                date: new Date(date),
                availableSlots: newSlots
            });
        } else {
            // If schedule exists, update the available slots for that date
            schedule.availableSlots = newSlots;
        }

        // Save the updated doctor schedule
        await doctor.save();

        res.status(200).send('Slots updated successfully');
    } catch (error) {
        console.error('Error updating slots:', error);
        res.status(500).send('Error updating slots');
    }
});

// Step 6: Endpoint to Find Available Slots
app.get('/available-slots/:doctorId', async (req, res) => {
    try {
        const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });
        if (!doctor) return res.status(404).send('Doctor not found');

        res.json(doctor.schedule);
    } catch (error) {
        res.status(500).send('Error fetching available slots');
    }
});


// Step 7: Book appointment
app.post('/book-appointment', async (req, res) => {
    const { patientName, patientEmail, doctorId, appointmentTime } = req.body;

    try {
        // Find the doctor
        const doctor = await Doctor.findOne({ doctorId });
        if (!doctor) return res.status(404).send('Doctor not found');

        // Check if the requested slot is available
        const appointmentDate = new Date(appointmentTime).toISOString().split('T')[0];
        const slotTime = new Date(appointmentTime).toISOString().split('T')[1].slice(0, 5);

        const schedule = doctor.schedule.find(day => 
            new Date(day.date).toISOString().split('T')[0] === appointmentDate
        );

        if (!schedule || !schedule.availableSlots.includes(slotTime)) {
            return res.status(400).send('Slot not available');
        }

        // Create the appointment
        const appointment = new Appointment({
            patientName,
            patientEmail,
            doctorId,
            appointmentTime,
        });

        await appointment.save();

        // Remove the slot from the doctor's schedule
        schedule.availableSlots = schedule.availableSlots.filter(slot => slot !== slotTime);
        await doctor.save();

        res.status(201).send('Appointment booked successfully');
    } catch (error) {
        console.error('Error booking appointment:', error);
        res.status(500).send('Error booking appointment');
    }
});

app.get('/appointments', async (req, res) => {
    try {
        const appointments = await Appointment.find(); // Fetch all documents from the collection
        res.status(200).json(appointments); // Respond with JSON data
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).send('Error fetching appointments');
    }
});

// Step 8: Conflict Resolution Middleware
const preventDoubleBooking = async (req, res, next) => {
    const { doctorId, newSlot } = req.body;

    try {
        const overlappingAppointment = await Appointment.findOne({
            doctorId,
            appointmentTime: new Date(`${newSlot.date}T${newSlot.time}`),
        });

        if (overlappingAppointment) {
            return res.status(400).send('Slot already booked');
        }

        next();
    } catch (error) {
        res.status(500).send('Error checking slot availability');
    }
};

// Step 9: Endpoint to Notify and Reschedule
app.post('/reschedule', preventDoubleBooking, async (req, res) => {
    const { appointmentId, newSlot } = req.body;

    try {
        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).send('Appointment not found');

        const doctor = await Doctor.findOne({ doctorId: appointment.doctorId });
        if (!doctor) return res.status(404).send('Doctor not found');

        const slotIndex = doctor.schedule.findIndex(
            (day) => day.date.toDateString() === new Date(newSlot.date).toDateString()
        );
        if (slotIndex === -1 || !doctor.schedule[slotIndex].availableSlots.includes(newSlot.time)) {
            return res.status(400).send('Slot not available');
        }

        // Update appointment
        appointment.status = 'Rescheduled';
        appointment.appointmentTime = new Date(`${newSlot.date}T${newSlot.time}`);
        await appointment.save();

        // Remove the selected slot from the doctor's schedule
        doctor.schedule[slotIndex].availableSlots = doctor.schedule[slotIndex].availableSlots.filter(
            (slot) => slot !== newSlot.time
        );
        await doctor.save();

        // Send notification (Email)
        const transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            auth: {
               user: 'alena3@ethereal.email',
               pass: 'pGEPut8M26PmzxycJt'
                  }
        });

        const mailOptions = {
            from: '"Medical Team 👻" <medicalteam@gmail.com>', // sender address
            to: appointment.patientEmail,
            subject: 'Appointment Rescheduled',
            text: `Your appointment has been rescheduled to ${newSlot.date} at ${newSlot.time}.`,
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                return res.status(500).send('Error notifying patient');
            }
            console.log('Email sent:', info.response);
            res.send('Appointment rescheduled and patient notified');
        });
    } catch (error) {
        res.status(500).send('Error rescheduling appointment');
    }
});

