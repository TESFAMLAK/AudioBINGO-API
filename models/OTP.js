import mongoose from 'mongoose';

const OTPSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
  },
  otp: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300, // OTP expires after 5 minutes
  },
});

const OTP = mongoose.model('OTP', OTPSchema);
export default OTP;
