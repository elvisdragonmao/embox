// ── Utilities ──────────────────────────────────────────────
const esc = s => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

const showToast = (msg, duration = 2200) => {
	const t = document.getElementById("toast");
	t.textContent = msg;
	t.classList.add("show");
	clearTimeout(t._tid);
	t._tid = setTimeout(() => t.classList.remove("show"), duration);
};

// ── Thread slider ──────────────────────────────────────────
const threadSlider = document.getElementById("threadCount");
const threadVal = document.getElementById("threadVal");
threadSlider.addEventListener("input", () => {
	threadVal.textContent = threadSlider.value;
});
const getThreads = () => parseInt(threadSlider.value, 10);

// ── Chunked upload ─────────────────────────────────────────
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per chunk

const uploadFileChunked = async (file, onProgress) => {
	const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
	const uploadId = crypto.randomUUID();
	const threads = getThreads();

	let uploaded = 0;
	let nextChunk = 0;

	const uploadChunk = async index => {
		const start = index * CHUNK_SIZE;
		const end = Math.min(start + CHUNK_SIZE, file.size);
		const blob = file.slice(start, end);
		const fd = new FormData();
		fd.append("uploadId", uploadId);
		fd.append("chunkIndex", String(index));
		fd.append("totalChunks", String(totalChunks));
		fd.append("filename", encodeURIComponent(file.name));
		fd.append("chunk", blob);

		await fetch("/upload/chunk", { method: "POST", body: fd });
		uploaded++;
		onProgress(uploaded / totalChunks);
	};

	// worker pool
	const worker = async () => {
		while (nextChunk < totalChunks) {
			const idx = nextChunk++;
			await uploadChunk(idx);
		}
	};

	const pool = Array.from({ length: Math.min(threads, totalChunks) }, worker);
	await Promise.all(pool);

	// assemble
	const res = await fetch("/upload/assemble", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			uploadId,
			totalChunks,
			filename: encodeURIComponent(file.name)
		})
	});
	return res.json();
};

const uploadFiles = async files => {
	const area = document.getElementById("uploadArea");
	area.innerHTML = "";
	const items = [];

	for (const file of files) {
		const el = document.createElement("div");
		el.className = "upload-item";
		el.innerHTML = `
                        <div class="upload-item-header">
                            <span class="upload-item-name">${esc(file.name)}</span>
                            <span class="upload-item-pct">0%</span>
                        </div>
                        <div class="progress-bar-wrap"><div class="progress-bar"></div></div>`;
		area.appendChild(el);
		items.push({ el, file });
	}

	await Promise.all(
		items.map(({ el, file }) => {
			const bar = el.querySelector(".progress-bar");
			const pct = el.querySelector(".upload-item-pct");
			return uploadFileChunked(file, p => {
				const v = Math.round(p * 100);
				bar.style.width = v + "%";
				pct.textContent = v + "%";
			});
		})
	);

	area.innerHTML = "";
	loadFileList();
};

// ── File list ──────────────────────────────────────────────
const formatExt = ext => (ext.length > 4 ? ext.slice(0, 4) : ext);

const loadFileList = () => {
	fetch("/list")
		.then(r => r.json())
		.then(files => {
			const fileList = document.getElementById("fileList");
			files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

			if (files.length === 0) {
				fileList.innerHTML = `<p style="margin:auto;color:var(--muted);font-size:0.9rem">No files yet</p>`;
				return;
			}

			fileList.innerHTML = files
				.map(
					file => `
                            <div class="file" data-file="${esc(file.file)}" role="button" tabindex="0" aria-label="Download ${esc(file.file)}">
                                <div class="type ${esc(file.extension)}">${esc(formatExt(file.extension))}</div>
                                <div class="text">
                                    <h3>${esc(file.file)}</h3>
                                    <p>${esc(file.size)}&nbsp;&nbsp;${new Date(file.uploadDate).toLocaleString()}</p>
                                </div>
                                <button class="action-btn copy-btn" data-file="${esc(file.file)}" title="Copy URL">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                    Copy URL
                                </button>
                                <div class="dl-progress"></div>
                            </div>`
				)
				.join("");

			// Bind copy buttons
			fileList.querySelectorAll(".copy-btn").forEach(btn => {
				btn.addEventListener("click", e => {
					e.stopPropagation();
					const name = btn.dataset.file;
					const url = `${location.origin}/box?file=${encodeURIComponent(name)}`;
					navigator.clipboard.writeText(url).then(() => showToast("URL copied!"));
				});
			});

			// Row click → download
			fileList.querySelectorAll(".file").forEach(row => {
				row.addEventListener("click", () => dl(row.dataset.file, row));
				row.addEventListener("keydown", e => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						dl(row.dataset.file, row);
					}
				});
			});
		})
		.catch(err => console.error("Error fetching files:", err));
};
loadFileList();

// ── Download with progress bar ─────────────────────────────
const dl = (filename, rowEl) => {
	const progressEl = rowEl?.querySelector(".dl-progress");
	const url = `/box?file=${encodeURIComponent(filename)}`;

	fetch(url).then(async response => {
		const contentType = response.headers.get("content-type") || "";
		if (contentType.includes("text/html")) {
			window.location.href = url;
			return;
		}

		const contentLength = response.headers.get("content-length");
		const total = contentLength ? parseInt(contentLength, 10) : null;
		const reader = response.body.getReader();
		const chunks = [];
		let received = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			received += value.length;
			if (total && progressEl) {
				progressEl.style.width = Math.round((received / total) * 100) + "%";
			}
		}

		if (progressEl) {
			progressEl.style.width = "100%";
			setTimeout(() => {
				progressEl.style.width = "0%";
			}, 600);
		}

		const blob = new Blob(chunks);
		const objUrl = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = objUrl;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(objUrl);
	});
};

// ── File input change → chunked upload ─────────────────────
document.getElementById("file").addEventListener("change", event => {
	const files = Array.from(event.target.files);
	if (files.length) uploadFiles(files);
	event.target.value = "";
});

// ── Drag and drop ──────────────────────────────────────────
const dragOverEl = document.getElementById("dragOver");

document.addEventListener("dragover", event => {
	event.preventDefault();
	dragOverEl.style.opacity = "1";
});

document.addEventListener("dragleave", event => {
	if (event.relatedTarget === null) dragOverEl.style.opacity = "0";
});

document.addEventListener("drop", event => {
	event.preventDefault();
	dragOverEl.style.opacity = "0";
	const files = Array.from(event.dataTransfer.files);
	if (files.length) uploadFiles(files);
});

// Space/Enter on drag label
document.getElementById("drag").addEventListener("keydown", e => {
	if (e.key === " " || e.key === "Enter") {
		e.preventDefault();
		document.getElementById("file").click();
	}
});
