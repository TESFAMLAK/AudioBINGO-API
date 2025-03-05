import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  type: { type: String, enum: ["info", "warning", "error"], default: "info" },
  createdAt: { type: Date, default: Date.now, expires: "1d" },
  read: { type: Boolean, default: false },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", index: true },
});


const Notification = mongoose.model('Notification', NotificationSchema);
export default Notification;
