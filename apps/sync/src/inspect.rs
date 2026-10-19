use std::path::Path;

use anyhow::{Context, Result};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, RgbaImage};
use tracing::warn;

use crate::api::ToneAnalysis;

const THUMBNAIL_SIZE: u32 = 600;
const THUMBHASH_SIZE: u32 = 100;

#[derive(Debug, Default)]
pub struct MediaInfo {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub thumb_hash: Option<String>,
    pub tone_analysis: Option<ToneAnalysis>,
    pub thumbnail: Option<Vec<u8>>,
}

pub fn inspect_file(path: &Path) -> Result<MediaInfo> {
    let extension = extension(path);
    let image = if is_heic(&extension) {
        match decode_heic(path) {
            Ok(image) => image,
            Err(error) => {
                warn!(file = %path.display(), %error, "HEIC 解码失败，跳过缩略图");
                return Ok(MediaInfo::default());
            }
        }
    } else if is_raw(&extension) {
        return Ok(MediaInfo::default());
    } else {
        match image::ImageReader::open(path)
            .with_context(|| format!("打开图片失败: {}", path.display()))?
            .with_guessed_format()
            .context("识别图片格式失败")?
            .decode()
        {
            Ok(image) => image,
            Err(error) => {
                warn!(file = %path.display(), %error, "图片解码失败，跳过缩略图");
                return Ok(MediaInfo::default());
            }
        }
    };

    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return Ok(MediaInfo::default());
    }

    let hash_size = fit_size(width, height, THUMBHASH_SIZE);
    let hash_image = image::imageops::resize(
        &image.to_rgba8(),
        hash_size.0,
        hash_size.1,
        FilterType::Triangle,
    );
    let thumb_hash = hex::encode(thumbhash::rgba_to_thumb_hash(
        hash_size.0 as usize,
        hash_size.1 as usize,
        hash_image.as_raw(),
    ));
    let tone_analysis = analyze_tone(hash_image.as_raw());

    let thumbnail = image.thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE).to_rgba8();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 90)
        .encode_image(&DynamicImage::ImageRgba8(thumbnail))
        .context("生成缩略图失败")?;

    Ok(MediaInfo {
        width: Some(width),
        height: Some(height),
        thumb_hash: Some(thumb_hash),
        tone_analysis,
        thumbnail: Some(jpeg),
    })
}

fn fit_size(width: u32, height: u32, max: u32) -> (u32, u32) {
    let scale = (max as f64 / width.max(height) as f64).min(1.0);
    (
        (width as f64 * scale).round().max(1.0) as u32,
        (height as f64 * scale).round().max(1.0) as u32,
    )
}

fn decode_heic(path: &Path) -> Result<DynamicImage> {
    use zune_heic::zune_core::bytestream::ZCursor;
    use zune_heic::zune_core::colorspace::ColorSpace;

    let bytes =
        std::fs::read(path).with_context(|| format!("读取 HEIC 失败: {}", path.display()))?;
    let mut decoder = zune_heic::HeifDecoder::new(ZCursor::new(&bytes));
    let pixels = decoder.decode().context("HEIC 解码失败")?;
    let width = decoder.width().context("HEIC 缺少宽度")? as u32;
    let height = decoder.height().context("HEIC 缺少高度")? as u32;
    let colorspace = decoder.colorspace().context("HEIC 缺少颜色空间")?;

    let rgba = match colorspace {
        ColorSpace::RGBA => {
            RgbaImage::from_raw(width, height, pixels).context("HEIC RGBA 数据长度不匹配")?
        }
        ColorSpace::RGB => {
            let mut rgba = Vec::with_capacity(pixels.len() / 3 * 4);
            for pixel in pixels.as_chunks::<3>().0 {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
            RgbaImage::from_raw(width, height, rgba).context("HEIC RGB 数据长度不匹配")?
        }
        other => anyhow::bail!("不支持的 HEIC 颜色空间: {other:?}"),
    };

    Ok(DynamicImage::ImageRgba8(rgba))
}

fn analyze_tone(data: &[u8]) -> Option<ToneAnalysis> {
    let pixel_count = data.len() / 4;
    if pixel_count == 0 {
        return None;
    }

    let mut luminance = [0u64; 256];
    for pixel in data.as_chunks::<4>().0 {
        let value = (0.2126 * pixel[0] as f64 + 0.7152 * pixel[1] as f64 + 0.0722 * pixel[2] as f64)
            .round()
            .clamp(0.0, 255.0) as usize;
        luminance[value] += 1;
    }

    let mut total_luminance = 0f64;
    for (value, count) in luminance.iter().enumerate() {
        total_luminance += value as f64 * *count as f64;
    }
    let mean = total_luminance / pixel_count as f64;
    let brightness = (mean * (100.0 / 255.0)).round() as u32;

    let shadow_ratio = luminance[..86].iter().sum::<u64>() as f64 / pixel_count as f64;
    let highlight_ratio = luminance[170..].iter().sum::<u64>() as f64 / pixel_count as f64;

    let variance = luminance
        .iter()
        .enumerate()
        .map(|(value, count)| *count as f64 * (value as f64 - mean).powi(2))
        .sum::<f64>()
        / pixel_count as f64;
    let contrast = ((variance.sqrt() / 127.5) * 100.0).round().min(100.0) as u32;

    let tone_type = if brightness < 30 && shadow_ratio > 0.6 {
        "low-key"
    } else if brightness > 70 && highlight_ratio > 0.6 {
        "high-key"
    } else if contrast > 60 && shadow_ratio > 0.3 && highlight_ratio > 0.3 {
        "high-contrast"
    } else {
        "normal"
    };

    Some(ToneAnalysis {
        tone_type: tone_type.to_string(),
        brightness,
        contrast,
        shadow_ratio: (shadow_ratio * 100.0).round() / 100.0,
        highlight_ratio: (highlight_ratio * 100.0).round() / 100.0,
    })
}

pub fn extension(path: &Path) -> String {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn is_heic(extension: &str) -> bool {
    matches!(extension, "heic" | "heif" | "hif")
}

pub fn is_raw(extension: &str) -> bool {
    matches!(
        extension,
        "raw" | "dng" | "cr2" | "cr3" | "nef" | "arw" | "orf" | "rw2" | "raf" | "srw"
    )
}

pub fn is_supported(path: &Path) -> bool {
    let extension = extension(path);
    matches!(
        extension.as_str(),
        "jpg"
            | "jpeg"
            | "png"
            | "gif"
            | "webp"
            | "bmp"
            | "tif"
            | "tiff"
            | "avif"
            | "heic"
            | "heif"
            | "hif"
            | "mov"
            | "mp4"
            | "m4v"
            | "raw"
            | "dng"
            | "cr2"
            | "cr3"
            | "nef"
            | "arw"
            | "orf"
            | "rw2"
            | "raf"
            | "srw"
    )
}

pub fn is_video(path: &Path) -> bool {
    matches!(extension(path).as_str(), "mov" | "mp4" | "m4v")
}

pub fn content_type(path: &Path) -> &'static str {
    match extension(path).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "avif" => "image/avif",
        "heic" | "heif" | "hif" => "image/heic",
        "mov" => "video/quicktime",
        "mp4" => "video/mp4",
        "m4v" => "video/x-m4v",
        "dng" => "image/x-adobe-dng",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tone_analysis_matches_flat_gray() {
        let pixels = vec![128u8; 100 * 4];
        let tone = analyze_tone(&pixels).expect("tone");
        assert_eq!(tone.brightness, 50);
        assert_eq!(tone.contrast, 0);
        assert_eq!(tone.tone_type, "normal");
    }

    #[test]
    fn fit_size_keeps_aspect_ratio() {
        assert_eq!(fit_size(2000, 1000, 100), (100, 50));
        assert_eq!(fit_size(50, 100, 100), (50, 100));
    }
}
