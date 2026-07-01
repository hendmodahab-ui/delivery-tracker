import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { getDb } from './database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'replace_this_with_secure_secret';
const JWT_EXPIRES_IN = '8h';

export async function loginHandler(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const payload = {
      id: user.id,
      role: user.role,
      deliveryman_id: user.deliveryman_id || null
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.json({
      token,
      role: user.role,
      username: user.username,
      deliverymanId: user.deliveryman_id || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'No token provided.' });

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Malformed token.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You are not allowed to perform this action.' });
    }
    next();
  };
}
