import express, { Request, Response } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const BOX_DIR = path.resolve(__dirname, "..", "box");
const TEMP_DIR = path.resolve(__dirname, "..", "box", ".tmp");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Ensure directories exist
if (!fs.existsSync(BOX_DIR)) fs.mkdirSync(BOX_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// --- Multer for single-shot uploads ---
const storage = multer.diskStorage({
	destination: (_req, _file, cb) => {
		cb(null, BOX_DIR);
	},
	filename: (_req, file, cb) => {
		const name = Buffer.from(file.originalname, "latin1").toString("utf8");
		cb(null, resolveUniqueFilename(name));
	}
});

const upload = multer({ storage }).array("file");

// --- Multer for chunk uploads (stored in temp) ---
const chunkStorage = multer.diskStorage({
	destination: (_req, _file, cb) => {
		cb(null, TEMP_DIR);
	},
	filename: (req, _file, cb) => {
		const { uploadId, chunkIndex } = req.body as {
			uploadId: string;
			chunkIndex: string;
		};
		cb(null, `${uploadId}_${chunkIndex}`);
	}
});
const uploadChunk = multer({ storage: chunkStorage }).single("chunk");

// --- Helpers ---
const resolveUniqueFilename = (name: string): string => {
	let filePath = path.join(BOX_DIR, name);
	if (!fs.existsSync(filePath)) return name;
	let count = 1;
	const ext = path.extname(name);
	const base = path.basename(name, ext);
	while (fs.existsSync(filePath)) {
		const candidate = `${base}_${count}${ext}`;
		filePath = path.join(BOX_DIR, candidate);
		count++;
	}
	return path.basename(filePath);
};

const getFileExtension = (filename: string): string => (filename.includes(".") ? filename.split(".").pop()! : "");

const getFileSize = (filename: string): string => {
	const stats = fs.statSync(path.join(BOX_DIR, filename));
	const kb = stats.size / 1024;
	if (kb < 1024) return kb.toFixed(2) + " KB";
	return (kb / 1024).toFixed(2) + " MB";
};

// --- Routes ---

// Serve main page
app.get("/", (_req: Request, res: Response) => {
	res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// List files
app.get("/list", (_req: Request, res: Response) => {
	fs.readdir(BOX_DIR, (err, files) => {
		if (err) return res.status(500).send("Unable to read directory contents.");
		const filtered = files.filter(f => !f.startsWith("."));
		const reply = filtered.map(file => ({
			extension: getFileExtension(file),
			file,
			size: getFileSize(file),
			uploadDate: new Date(fs.statSync(path.join(BOX_DIR, file)).mtime).toUTCString()
		}));
		res.json(reply);
	});
});

// Download file
app.get("/box", (req: Request, res: Response) => {
	const file = req.query.file as string | undefined;
	if (!file) {
		res.redirect("/");
		return;
	}
	const normalizedFilePath = path.resolve(BOX_DIR, file);
	if (!normalizedFilePath.startsWith(BOX_DIR)) {
		res.status(403).send("Forbidden.");
		return;
	}
	if (!fs.existsSync(normalizedFilePath)) {
		res.status(404).send("File not found.");
		return;
	}
	res.sendFile(normalizedFilePath);
});

// Single-shot upload (legacy / small files)
app.post("/upload", (req: Request, res: Response) => {
	upload(req, res, err => {
		if (err) return res.status(500).send("Error uploading file.");
		res.redirect("/");
	});
});

// --- Chunked upload endpoints ---

// POST /upload/chunk — receive one chunk
// Body fields: uploadId, chunkIndex, totalChunks, filename
app.post("/upload/chunk", (req: Request, res: Response) => {
	uploadChunk(req, res, err => {
		if (err) return res.status(500).json({ error: "Chunk upload failed." });
		res.json({ ok: true });
	});
});

// POST /upload/assemble — called after all chunks uploaded
// Body: { uploadId, totalChunks, filename }
app.post("/upload/assemble", express.json(), async (req: Request, res: Response) => {
	const { uploadId, totalChunks, filename } = req.body as {
		uploadId: string;
		totalChunks: number;
		filename: string;
	};

	if (!uploadId || !totalChunks || !filename) {
		res.status(400).json({ error: "Missing parameters." });
		return;
	}

	const decodedName = decodeURIComponent(filename);
	const finalName = resolveUniqueFilename(decodedName);
	const finalPath = path.join(BOX_DIR, finalName);

	try {
		const writeStream = fs.createWriteStream(finalPath);
		for (let i = 0; i < totalChunks; i++) {
			const chunkPath = path.join(TEMP_DIR, `${uploadId}_${i}`);
			if (!fs.existsSync(chunkPath)) {
				writeStream.destroy();
				fs.unlinkSync(finalPath);
				res.status(400).json({ error: `Missing chunk ${i}.` });
				return;
			}
			const data = fs.readFileSync(chunkPath);
			writeStream.write(data);
			fs.unlinkSync(chunkPath);
		}
		writeStream.end();
		await new Promise<void>((resolve, reject) => {
			writeStream.on("finish", resolve);
			writeStream.on("error", reject);
		});
		res.json({ ok: true, filename: finalName });
	} catch {
		res.status(500).json({ error: "Assembly failed." });
	}
});

app.listen(PORT, () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
