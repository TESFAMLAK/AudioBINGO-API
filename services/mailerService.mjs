import nodemailer from "nodemailer";

// transporter configuration (around line 150)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'tesunlocks@gmail.com',
      pass: process.env.EMAIL_PASSWORD,
    },
    debug: true, // Enable debug logging
    logger: true, // Enable logger
  });
  
  // Test email configuration at startup
  transporter.verify((error, success) => {
    if (error) {
      console.error('Email configuration error:', {
        name: error.name,
        message: error.message,
        code: error.code,
      });
    } else {
      console.log('Email server is ready:', success);
    }
  });

export {transporter}
