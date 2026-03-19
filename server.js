try { require('dotenv').config(); } catch (_) {}

const express        = require('express');
const { createServer } = require('http');
const { Server }     = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors           = require('cors');
const path           = require('path');
const fs             = require('fs');
const session        = require('express-session');
const passport       = require('passport');
const LocalStrategy  = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt         = require('bcryptjs');

const app        = express();
const httpServer = createServer(app);

// ── Data files ───────────────────────────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, 'data');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const MEETINGS_FILE = path.join(DATA_DIR, 'meetings.json');

if (!fs.existsSync(DATA_DIR))      fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE))    fs.writeFileSync(USERS_FILE,    '[]', 'utf8');
if (!fs.existsSync(MEETINGS_FILE)) fs.writeFileSync(MEETINGS_FILE, '[]', 'utf8');

// ── File helpers ─────────────────────────────────────────────────────────────
const readUsers    = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE,    'utf8')); } catch(_){ return []; } };
const writeUsers   = u  => fs.writeFileSync(USERS_FILE,    JSON.stringify(u, null, 2), 'utf8');
const readMeetings = () => { try { return JSON.parse(fs.readFileSync(MEETINGS_FILE, 'utf8')); } catch(_){ return []; } };
const writeMeetings= m  => fs.writeFileSync(MEETINGS_FILE, JSON.stringify(m, null, 2), 'utf8');

const findUserById      = id    => readUsers().find(u => u.id === id);
const findUserByEmail   = email => readUsers().find(u => u.email?.toLowerCase() === email?.toLowerCase());
const findUserByGoogleId= gid   => readUsers().find(u => u.googleId === gid);

const genRoomId = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

// ── Session ──────────────────────────────────────────────────────────────────
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'nexus-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000
  }
});

// ── Passport ─────────────────────────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, findUserById(id) || false));

passport.use(new LocalStrategy(
  { usernameField: 'email', passwordField: 'password' },
  async (email, password, done) => {
    const user = findUserByEmail(email);
    if (!user)              return done(null, false, { message: 'No account found with that email.' });
    if (!user.passwordHash) return done(null, false, { message: 'This account uses Google Sign-In.' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok)                return done(null, false, { message: 'Incorrect password.' });
    return done(null, user);
  }
));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
    },
    (accessToken, refreshToken, profile, done) => {
      const users = readUsers();
      const email = profile.emails?.[0]?.value;

      let user = findUserByGoogleId(profile.id);
      if (user) return done(null, user);

      user = email ? findUserByEmail(email) : null;
      if (user) {
        user.googleId = profile.id;
        user.avatar   = profile.photos?.[0]?.value || user.avatar;
        writeUsers(users.map(u => u.id === user.id ? user : u));
        return done(null, user);
      }

      const newUser = {
        id:           uuidv4(),
        name:         profile.displayName || 'NEXUS User',
        email:        email || null,
        passwordHash: null,
        googleId:     profile.id,
        avatar:       profile.photos?.[0]?.value || null,
        initial:      (profile.displayName || 'N').charAt(0).toUpperCase(),
        createdAt:    new Date().toISOString()
      };
      users.push(newUser);
      writeUsers(users);
      return done(null, newUser);
    }
  ));
}

// ── Express middleware ────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// Serve static assets but NOT html directly
app.use('/css',  express.static(path.join(__dirname, 'public', 'css')));
app.use('/js',   express.static(path.join(__dirname, 'public', 'js')));

// ── Auth guard ────────────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
};

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/call', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'call.html'));
});

app.get('/logout', (req, res) => {
  req.logout(() => { req.session.destroy(); res.redirect('/login'); });
});

// ── Auth API ──────────────────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (findUserByEmail(email))
    return res.status(400).json({ error: 'An account with this email already exists.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(), name: name.trim().substring(0, 50),
    email: email.toLowerCase().trim(), passwordHash,
    googleId: null, avatar: null,
    initial: name.trim().charAt(0).toUpperCase(),
    createdAt: new Date().toISOString()
  };
  const users = readUsers();
  users.push(newUser);
  writeUsers(users);

  req.login(newUser, err => {
    if (err) return res.status(500).json({ error: 'Signup succeeded but login failed.' });
    const { passwordHash: _, ...safe } = newUser;
    res.json({ success: true, user: safe });
  });
});

app.post('/api/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err)   return res.status(500).json({ error: 'Server error.' });
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials.' });
    req.login(user, err2 => {
      if (err2) return res.status(500).json({ error: 'Login failed.' });
      const { passwordHash: _, ...safe } = user;
      res.json({ success: true, user: safe });
    });
  })(req, res, next);
});

app.get('/api/me', requireAuth, (req, res) => {
  const { passwordHash: _, ...safe } = req.user;
  res.json(safe);
});

app.put('/api/me', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found.' });
  users[idx].name    = name.trim().substring(0, 50);
  users[idx].initial = name.trim().charAt(0).toUpperCase();
  writeUsers(users);
  const { passwordHash: _, ...safe } = users[idx];
  req.login(users[idx], () => res.json(safe));
});

// ── Google OAuth ──────────────────────────────────────────────────────────────
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google' }),
  (req, res) => {
    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

// ── Meetings API ──────────────────────────────────────────────────────────────
app.get('/api/meetings', requireAuth, (req, res) => {
  const mine = readMeetings()
    .filter(m => m.hostId === req.user.id || m.participants?.some(p => p.userId === req.user.id))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  res.json(mine);
});

app.post('/api/meetings/create', requireAuth, (req, res) => {
  const roomId  = genRoomId();
  const meeting = {
    id: uuidv4(), roomId,
    title:     req.body.title?.trim() || `Meeting ${roomId}`,
    hostId:    req.user.id,
    hostName:  req.user.name,
    startedAt: new Date().toISOString(),
    endedAt:   null, duration: null, participants: []
  };
  const meetings = readMeetings();
  meetings.push(meeting);
  writeMeetings(meetings);
  res.json({ roomId, meetingId: meeting.id });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok', rooms: rooms.size,
  users: readUsers().length, meetings: readMeetings().length, uptime: process.uptime()
}));

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ roomId: room.id, peerCount: room.peers.size,
    peers: Array.from(room.peers.values()).map(p => ({ socketId: p.socketId, name: p.name })) });
});

// ── Room store ────────────────────────────────────────────────────────────────
const rooms = new Map();

const createRoom = roomId => {
  const room = { id: roomId, createdAt: Date.now(), peers: new Map() };
  rooms.set(roomId, room);
  return room;
};

const cleanupEmptyRooms = () => {
  for (const [id, room] of rooms) {
    if (room.peers.size === 0) rooms.delete(id);
  }
};

// ── Socket.IO signaling ───────────────────────────────────────────────────────
io.on('connection', socket => {
  const sessionUser = socket.request.session?.passport?.user
    ? findUserById(socket.request.session.passport.user) : null;

  let currentRoom      = null;
  let currentName      = null;
  let currentMeetingId = null;

  socket.on('join-room', ({ roomId, name }) => {
    if (!roomId || !name) return;
    if (currentRoom) leaveRoom();

    currentRoom = roomId.toUpperCase();
    currentName = sessionUser ? sessionUser.name : name.trim().substring(0, 30);

    const isNew = !rooms.has(currentRoom);
    if (isNew) createRoom(currentRoom);

    const room = rooms.get(currentRoom);
    const existing = Array.from(room.peers.values()).map(p => ({ socketId: p.socketId, name: p.name }));

    room.peers.set(socket.id, { socketId: socket.id, name: currentName, userId: sessionUser?.id || null });
    socket.join(currentRoom);

    // Save to file
    const meetings = readMeetings();
    if (isNew) {
      const m = {
        id: uuidv4(), roomId: currentRoom,
        title:     `${currentName}'s Meeting`,
        hostId:    sessionUser?.id || null,
        hostName:  currentName,
        startedAt: new Date().toISOString(),
        endedAt: null, duration: null,
        participants: [{ userId: sessionUser?.id || null, name: currentName, joinedAt: new Date().toISOString(), leftAt: null }]
      };
      meetings.push(m);
      currentMeetingId = m.id;
    } else {
      const m = meetings.find(m => m.roomId === currentRoom && !m.endedAt);
      if (m) {
        m.participants.push({ userId: sessionUser?.id || null, name: currentName, joinedAt: new Date().toISOString(), leftAt: null });
        currentMeetingId = m.id;
      }
    }
    writeMeetings(meetings);

    socket.emit('room-joined', { roomId: currentRoom, peers: existing, mySocketId: socket.id });
    socket.to(currentRoom).emit('peer-joined', { socketId: socket.id, name: currentName });
  });

  socket.on('offer',         ({ to, offer })     => socket.to(to).emit('offer',         { from: socket.id, fromName: currentName, offer }));
  socket.on('answer',        ({ to, answer })    => socket.to(to).emit('answer',        { from: socket.id, answer }));
  socket.on('ice-candidate', ({ to, candidate }) => socket.to(to).emit('ice-candidate', { from: socket.id, candidate }));

  socket.on('chat-message', ({ roomId, text }) => {
    if (!currentRoom || currentRoom !== roomId?.toUpperCase()) return;
    socket.to(currentRoom).emit('chat-message', { from: socket.id, name: currentName, text: text.substring(0, 500), timestamp: Date.now() });
  });

  socket.on('media-state', ({ audio, video }) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('peer-media-state', { socketId: socket.id, audio, video });
  });

  function leaveRoom() {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (room) {
      room.peers.delete(socket.id);
      socket.to(currentRoom).emit('peer-left', { socketId: socket.id, name: currentName });
    }
    socket.leave(currentRoom);

    if (currentMeetingId) {
      const meetings = readMeetings();
      const m = meetings.find(m => m.id === currentMeetingId);
      if (m) {
        const p = m.participants.filter(p => p.name === currentName).find(p => !p.leftAt);
        if (p) p.leftAt = new Date().toISOString();
        if (!room || room.peers.size === 0) {
          m.endedAt  = new Date().toISOString();
          m.duration = Math.floor((new Date(m.endedAt) - new Date(m.startedAt)) / 1000);
        }
        writeMeetings(meetings);
      }
    }

    cleanupEmptyRooms();
    currentRoom = null; currentMeetingId = null;
  }

  socket.on('leave-room',  leaveRoom);
  socket.on('disconnect', () => leaveRoom());
});

// ── Catch-all ─────────────────────────────────────────────────────────────────
app.use((req, res) => res.redirect('/login'));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n  NEXUS running → http://localhost:${PORT}`);
  console.log(`  Google OAuth : ${process.env.GOOGLE_CLIENT_ID ? 'configured' : 'not set (email login only)'}\n`);
});

module.exports = { app, io };
