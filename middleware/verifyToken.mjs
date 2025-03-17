import jwt from "jsonwebtoken";
//  verifyToken middleware to include more information
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res
        .status(403)
        .json({ valid: false, message: 'No token provided.' });
    }
  
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res
          .status(401)
          .json({ valid: false, message: 'Failed to authenticate token.' });
      }
      req.admin = {
        id: decoded.id,
        username: decoded.username,
        role: decoded.role,
      };
      next();
    });
  };
  export {verifyToken}
