# embox

A self-hosted file sharing site. Upload and download files from anywhere.

**Live demo:** https://box.elvismao.com

## Features

- Chunked upload with configurable parallel threads
- Multi-thread download via HTTP Range requests
- Drag and drop support
- Per-file upload progress bars and download progress indicator
- Automatic deduplication of filenames on conflict
- Dark mode support

## Stack

- **Backend:** Node.js, Express, Multer, TypeScript
- **Frontend:** Vanilla JS, no frameworks

## Getting Started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

### Production

```bash
pnpm build
pnpm start
```

## Configuration

| Environment variable | Default | Description       |
| -------------------- | ------- | ----------------- |
| `PORT`               | `3000`  | Port to listen on |

Files are stored in the `box/` directory. Temporary chunk files are stored in `box/.tmp/` during upload assembly.

## Credits

Made by [Elvis Mao](https://elvismao.com). Quicksand font by [Andrew Paglinawan](https://www.fontsquirrel.com/fonts/quicksand).
