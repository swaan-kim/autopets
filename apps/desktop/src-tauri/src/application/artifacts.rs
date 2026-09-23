use crate::domain::artifacts::*;
use crate::domain::assistance::Identity;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub const MAX_PNG_BYTES: usize = 5 * 1024 * 1024;
pub struct ArtifactStore {
    pub(crate) db: Connection,
    pub(crate) image_dir: PathBuf,
}

impl ArtifactStore {
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        Ok(Snapshot {
            projects: self.projects()?,
            styles: self.styles()?,
            capabilities: Capabilities::default(),
            observed_chats: vec![],
        })
    }
    pub fn image(&self, identity: &Identity, version_id: &str) -> Result<Vec<u8>, String> {
        let project = self.find(identity)?.ok_or("Unknown artifact project")?;
        if !project
            .versions
            .iter()
            .any(|version| version.id == version_id)
        {
            return Err("Unknown artifact version".into());
        }
        let path = self.image_path(version_id)?;
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take((MAX_PNG_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        validate_png(&bytes, MAX_PNG_BYTES)?;
        Ok(bytes)
    }
    /// The caller supplies only the OS-resolved Downloads directory, never a UI path.
    pub(crate) fn export_to_downloads(
        &self,
        identity: &Identity,
        version_id: &str,
        downloads: &Path,
    ) -> Result<String, String> {
        use std::io::Write;
        let bytes = self.image(identity, version_id)?;
        let root = downloads.canonicalize().map_err(|e| e.to_string())?;
        let target_dir = root.join("AutoPets");
        ensure_plain_directory(&target_dir)?;
        let canonical = target_dir.canonicalize().map_err(|e| e.to_string())?;
        if canonical.parent() != Some(root.as_path()) {
            return Err("Export directory is outside Downloads".into());
        }
        let path = canonical.join(format!("intro-{}.png", uuid::Uuid::new_v4()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(error.to_string());
        }
        Ok(path.to_string_lossy().into_owned())
    }
    pub(crate) fn image_path(&self, id: &str) -> Result<PathBuf, String> {
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid artifact image identifier")?;
        if parsed.to_string() != id {
            return Err("Invalid artifact image identifier".into());
        }
        ensure_plain_directory(&self.image_dir)?;
        if self.image_dir.canonicalize().map_err(|e| e.to_string())? != self.image_dir {
            return Err("Managed image directory moved outside storage".into());
        }
        let path = self.image_dir.join(format!("{id}.png"));
        if let Ok(metadata) = std::fs::symlink_metadata(&path) {
            if is_link(&metadata) || !metadata.is_file() {
                return Err("Artifact image path is not a regular file".into());
            }
            if path.canonicalize().map_err(|e| e.to_string())?.parent()
                != Some(self.image_dir.as_path())
            {
                return Err("Artifact image path escaped managed storage".into());
            }
        }
        Ok(path)
    }
}

impl crate::application::store::Store {
    /// Native manager discovery uses only real stored observations. This does not
    /// create a task or claim that a restored session has a live connection.
    pub fn artifact_snapshot(&self) -> Result<Snapshot, String> {
        use crate::domain::assistance::Provider;
        use sha2::{Digest, Sha256};
        let mut snapshot = self.artifacts.snapshot()?;
        snapshot.observed_chats = self
            .sessions
            .keys()
            .map(|chat_id| Identity {
                provider: Provider::Codex,
                account_id: format!("session:{:x}", Sha256::digest(chat_id.as_bytes())),
                chat_id: chat_id.clone(),
            })
            .collect();
        snapshot
            .observed_chats
            .sort_by(|a, b| a.chat_id.cmp(&b.chat_id));
        Ok(snapshot)
    }
}

pub(crate) fn ensure_plain_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        std::fs::create_dir(path).map_err(|e| e.to_string())?;
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Err("Managed directory must not be a symlink".into());
    }
    Ok(())
}

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes directory junctions as well as ordinary symbolic links.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub(crate) fn validate_style(style: &Style) -> Result<(), String> {
    if style.palette.is_empty()
        || style.palette.len() > 4
        || style.palette.iter().any(|value| {
            value.len() != 7
                || !value.starts_with('#')
                || !value[1..].bytes().all(|c| c.is_ascii_hexdigit())
        })
    {
        return Err("Use one to four #RRGGBB colors".into());
    }
    if let Some(logo) = &style.logo_data_url {
        if logo.len() > 700_000 {
            return Err("Logo exceeds the data URL limit".into());
        }
        let encoded = logo
            .strip_prefix("data:image/png;base64,")
            .ok_or("Logo must be a PNG data URL")?;
        let bytes = decode_base64(encoded)?;
        validate_png(&bytes, 500 * 1024)?;
    }
    Ok(())
}

fn decode_base64(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.is_empty() || encoded.len() % 4 != 0 {
        return Err("Invalid base64 PNG".into());
    }
    let mut out = Vec::with_capacity(encoded.len() / 4 * 3);
    let chunks = encoded.as_bytes().chunks_exact(4);
    let length = chunks.len();
    for (index, chunk) in chunks.enumerate() {
        let decode = |c: u8| -> Result<u8, String> {
            match c {
                b'A'..=b'Z' => Ok(c - b'A'),
                b'a'..=b'z' => Ok(c - b'a' + 26),
                b'0'..=b'9' => Ok(c - b'0' + 52),
                b'+' => Ok(62),
                b'/' => Ok(63),
                _ => Err("Invalid base64 PNG".into()),
            }
        };
        let a = decode(chunk[0])?;
        let b = decode(chunk[1])?;
        let padding = if chunk[2] == b'=' {
            2
        } else if chunk[3] == b'=' {
            1
        } else {
            0
        };
        if padding > 0 && index + 1 != length || padding == 2 && chunk[3] != b'=' {
            return Err("Invalid base64 padding".into());
        }
        let c = if padding == 2 { 0 } else { decode(chunk[2])? };
        let d = if padding > 0 { 0 } else { decode(chunk[3])? };
        if padding == 2 && b & 15 != 0 || padding == 1 && c & 3 != 0 {
            return Err("Invalid base64 padding bits".into());
        }
        out.push(a << 2 | b >> 4);
        if padding < 2 {
            out.push(b << 4 | c >> 2);
        }
        if padding == 0 {
            out.push(c << 6 | d);
        }
    }
    Ok(out)
}

/// Verify framing, CRCs and dimensions before decoding to bound allocation.
pub(crate) fn validate_png(bytes: &[u8], max: usize) -> Result<(u32, u32), String> {
    if bytes.len() > max || bytes.len() < 45 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("A valid bounded PNG is required".into());
    }
    let mut offset = 8usize;
    let mut dimensions = None;
    let mut ended = false;
    let mut data = false;
    while offset < bytes.len() {
        if bytes.len() - offset < 12 {
            return Err("Truncated PNG chunk".into());
        }
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let end = offset
            .checked_add(12)
            .and_then(|v| v.checked_add(length))
            .ok_or("Invalid PNG length")?;
        if end > bytes.len() {
            return Err("Truncated PNG data".into());
        }
        let kind = &bytes[offset + 4..offset + 8];
        let expected = u32::from_be_bytes(bytes[end - 4..end].try_into().unwrap());
        if crc32(&bytes[offset + 4..end - 4]) != expected {
            return Err("PNG checksum mismatch".into());
        }
        if offset == 8 {
            if kind != b"IHDR" || length != 13 {
                return Err("Missing PNG header".into());
            }
            let width = u32::from_be_bytes(bytes[offset + 8..offset + 12].try_into().unwrap());
            let height = u32::from_be_bytes(bytes[offset + 12..offset + 16].try_into().unwrap());
            if width == 0 || height == 0 || width > 4096 || height > 4096 {
                return Err("PNG dimensions must be between 1 and 4096".into());
            }
            dimensions = Some((width, height));
        } else if kind == b"IHDR" {
            return Err("Duplicate PNG header".into());
        }
        if kind == b"IDAT" {
            data = true;
        }
        if kind == b"acTL" {
            return Err("Use a static PNG".into());
        }
        if kind == b"IEND" {
            if length != 0 || end != bytes.len() || !data {
                return Err("Invalid PNG ending".into());
            }
            ended = true;
            break;
        }
        offset = end;
    }
    if !ended {
        return Err("Incomplete PNG".into());
    }
    let image = tauri::image::Image::from_bytes(bytes)
        .map_err(|e| format!("PNG could not be decoded: {e}"))?;
    let size = (image.width(), image.height());
    if dimensions != Some(size) {
        return Err("PNG decoded dimensions differ".into());
    }
    Ok(size)
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

fn normalized(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}
fn numbers(value: &str) -> Vec<String> {
    let chars: Vec<char> = value.chars().collect();
    let mut found = vec![];
    let mut index = 0;
    while index < chars.len() {
        if !chars[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < chars.len() {
            if chars[index].is_ascii_digit() {
                index += 1;
            } else if matches!(chars[index], '.' | ',')
                && chars.get(index + 1).is_some_and(char::is_ascii_digit)
            {
                index += 2;
            } else {
                break;
            }
        }
        if index < chars.len()
            && matches!(
                chars[index],
                '%' | '명' | '개' | '원' | '배' | '년' | '월' | '일'
            )
        {
            index += 1;
        }
        found.push(chars[start..index].iter().collect());
    }
    found
}
pub(crate) fn checks(brief: &Brief, rendered: &str) -> Vec<Check> {
    let reported = normalized(rendered);
    let missing: Vec<_> = std::iter::once(&brief.message)
        .chain(brief.points.iter())
        .filter(|point| !reported.contains(&normalized(point)))
        .collect();
    let source = format!(
        "{} {} {}",
        brief.source_text,
        brief.message,
        brief.points.join(" ")
    );
    let grounded = numbers(&source);
    let unknown: Vec<_> = numbers(rendered)
        .into_iter()
        .filter(|n| !grounded.contains(n))
        .collect();
    vec![
        Check {
            id: "png".into(),
            status: CheckStatus::Pass,
            detail: "PNG 형식·용량·실제 디코딩 크기를 확인했습니다.".into(),
            method: CheckMethod::Code,
        },
        Check {
            id: "content".into(),
            status: if missing.is_empty() {
                CheckStatus::Pass
            } else {
                CheckStatus::Warning
            },
            detail: if missing.is_empty() {
                "제공된 문구에 핵심 문장과 항목이 있습니다. 이미지 OCR 검사는 아닙니다.".into()
            } else {
                format!("문구 일치 미확인: {}. 바꿔 쓴 표현은 사람이 원문 충실도를 확인해주세요. 이미지 OCR 검사는 아닙니다.", missing.into_iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" · "))
            },
            method: CheckMethod::Code,
        },
        Check {
            id: "numbers".into(),
            status: if unknown.is_empty() {
                CheckStatus::Pass
            } else {
                CheckStatus::Warning
            },
            detail: if unknown.is_empty() {
                "제공된 문구에 브리프·근거에 없는 숫자를 찾지 못했습니다. 사실 검증은 아닙니다."
                    .into()
            } else {
                format!("브리프·근거에서 찾을 수 없는 숫자: {}", unknown.join(", "))
            },
            method: CheckMethod::Code,
        },
        Check {
            id: "readability".into(),
            status: CheckStatus::Pending,
            detail: "실제 이미지 글자를 사람이 확인해야 합니다.".into(),
            method: CheckMethod::Human,
        },
        Check {
            id: "layout".into(),
            status: CheckStatus::Pending,
            detail: "실제 배치·잘림·겹침을 사람이 확인해야 합니다.".into(),
            method: CheckMethod::Human,
        },
        Check {
            id: "fidelity".into(),
            status: CheckStatus::Pending,
            detail: "이미지와 브리프·근거가 일치하는지 사람이 확인해야 합니다.".into(),
            method: CheckMethod::Human,
        },
    ]
}

#[cfg(test)]
#[path = "tests/artifacts.rs"]
mod tests;
