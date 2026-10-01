use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

// Fit before showing the first window, including the native frame and taskbar.
pub(crate) fn show_fitted(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let area = monitor.work_area();
        let inner = window.inner_size()?;
        let outer = window.outer_size()?;
        let frame = PhysicalSize::new(
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        );
        let scale = window.scale_factor()?;
        let available = available_inner(area.size, frame, scale);
        window.set_min_size(Some(PhysicalSize::new(
            ((760.0 * scale) as u32).min(available.width),
            ((640.0 * scale) as u32).min(available.height),
        )))?;
        let size = PhysicalSize::new(inner.width.min(available.width), inner.height.min(available.height));
        window.set_size(size)?;
        let width = size.width.saturating_add(frame.width);
        let height = size.height.saturating_add(frame.height);
        window.set_position(PhysicalPosition::new(
            area.position.x + area.size.width.saturating_sub(width) as i32 / 2,
            area.position.y + area.size.height.saturating_sub(height) as i32 / 2,
        ))?;
    }
    window.show()
}

fn available_inner(work: PhysicalSize<u32>, frame: PhysicalSize<u32>, scale: f64) -> PhysicalSize<u32> {
    let margin = (16.0 * scale).ceil() as u32;
    PhysicalSize::new(
        work.width.saturating_sub(frame.width).saturating_sub(margin * 2).max(1),
        work.height.saturating_sub(frame.height).saturating_sub(margin * 2).max(1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_screen_leaves_space_for_native_frame_and_taskbar() {
        let size = available_inner(PhysicalSize::new(1024, 720), PhysicalSize::new(16, 39), 1.0);
        assert_eq!(size, PhysicalSize::new(976, 649));
        assert!(size.height + 39 < 720);
    }

    #[test]
    fn high_dpi_can_fit_below_the_normal_logical_minimum() {
        let size = available_inner(PhysicalSize::new(1920, 1040), PhysicalSize::new(32, 78), 2.0);
        assert_eq!(size, PhysicalSize::new(1824, 898));
        assert!((size.height as f64) / 2.0 < 640.0);
    }
}
