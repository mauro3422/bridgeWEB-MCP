# MCP binary and image transport

## Binary file attachments

`binary_file_attach` supports three modes. A stateful MCP session can register a bounded opaque resource link and resolve it with `resources/read`; each session owns its own registry, and reads recheck source size and SHA-256. Closing or reclaiming the session clears that registry.

The modern Bridge endpoint is stateless and creates a server for each request. It does not publish a shared resource inventory. `mode=embedded` returns the bytes with the tool response; `mode=both` falls back to that self-contained form; `mode=link` returns an error because a deferred read cannot be tied to an authenticated session on this endpoint. A modern inline resource URI is descriptive of the attached block only and is not a `resources/read` handle. Use `binary_file_read_chunk` for files too large for one MCP response.

## Chat preview preparation

`image_chat_preview_prepare` requires Python plus Pillow. The helper is `integrations/images/prepare_chat_preview.py`; set `BRIDGE_PYTHON_EXE` if the `python` command does not select the intended interpreter. The tool snapshots source bytes beside the requested output, verifies the snapshot SHA-256 in Python, and cleans up the temporary snapshot and config afterward. Sources larger than 40 million pixels are rejected before full decoding.

Choose a new `.jpg` or `.jpeg` output path. Existing files and symlinks are rejected, and publication uses an atomic same-directory hard link so a concurrent file creation cannot be overwritten. If the destination filesystem does not support hard links, the operation fails closed. The original source remains unchanged.
