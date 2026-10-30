#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_bounds_fit_a_different_monitor_work_area() {
        assert_eq!(
            clamp_bounds((-3000, -300), (4000, 2000), (0, 40, 1920, 1000)),
            ((0, 40), (1920, 1000))
        );
        assert_eq!(
            clamp_bounds((1800, 100), (1000, 700), (0, 40, 1920, 1000)),
            ((920, 100), (1000, 700))
        );
    }
    #[test]
    fn appearance_accepts_only_resolved_themes_and_a_boolean_accessibility_flag() {
        assert!(Appearance::from_payload(json!({"theme":"dark","transparency":true})).is_ok());
        for payload in [
            json!({"theme":"system","transparency":true}),
            json!({"theme":"dark","transparency":"yes"}),
            json!({"theme":"light","transparency":true,"url":"file:///"}),
        ] {
            assert!(Appearance::from_payload(payload).is_err());
        }
    }
    #[test]
    fn signed_update_verifier_rejects_tampering_and_foreign_key() {
        use minisign_verify::{PublicKey, Signature};
        let key =
            PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3")
                .unwrap();
        let signature=Signature::decode("untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==").unwrap();
        assert!(key.verify(b"test", &signature, false).is_ok());
        assert!(key
            .verify(b"tampered installer", &signature, false)
            .is_err());
        use base64::Engine;
        let production = base64::engine::general_purpose::STANDARD
            .decode(include_str!("../../updater.pub").trim())
            .unwrap();
        let production = PublicKey::decode(std::str::from_utf8(&production).unwrap()).unwrap();
        assert!(production.verify(b"test", &signature, false).is_err());
    }
    #[test]
    fn mailto_is_data_not_an_instruction() {
        let action = activation("mailto:a@example.com?subject=Hello%20world&body=line1%0Aline2&cc=c@example.com&attach=file:///secret").unwrap();
        assert_eq!(action["kind"], "compose");
        assert_eq!(action["payload"]["subject"], "Hello world");
        assert!(action["payload"].get("attach").is_none());
        assert!(activation("mailto:a@example.com?subject=bad%0D%0ABcc:evil").is_none());
        assert!(activation("kb-onemail://inbox").is_some());
        assert!(activation("kb-onemail://inbox.evil").is_none());
        assert!(activation("kb-onemail://inbox?next=file:///secret").is_none());
    }
    #[test]
    fn mailto_query_recipients_are_supported_without_duplicate_header_injection() {
        assert_eq!(
            activation("mailto:?to=alice%40example.com").unwrap()["payload"]["to"],
            "alice@example.com"
        );
        assert_eq!(
            activation("mailto:bob@example.com?to=alice@example.com").unwrap()["payload"]["to"],
            "bob@example.com,alice@example.com"
        );
        assert!(activation("mailto:?to=a@example.com&to=b@example.com").is_none());
        assert!(activation("mailto:?subject=bad%ZZ").is_none());
        assert!(activation("kb-onemail://inbox:9999").is_none());
        assert_eq!(
            activation("mailto:?TO=alice+tag@example.com&subject=A+B").unwrap()["payload"]
                ["subject"],
            "A+B"
        );
    }
    #[test]
    fn retries_are_bounded_and_a_success_restores_normal_polling() {
        assert_eq!(retry_delay(0), 300);
        assert_eq!(retry_delay(1), 30);
        assert_eq!(retry_delay(2), 60);
        assert_eq!(retry_delay(20), 900);
    }
    #[test]
    fn lifecycle_starts_unsafe_and_rejects_stale_quit_responses() {
        let mut state = Lifecycle::default();
        assert!(!state.safe());
        state.ready = true;
        state.busy = false;
        state.dirty = false;
        assert!(state.safe());
        state.pending = Some("current".into());
        assert!(!state.approve("old", true));
        assert!(state.approve("current", true));
        assert!(state.pending.is_none());
    }
}
use serde_json::{json, Value};
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppearanceTheme {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Appearance {
    pub theme: AppearanceTheme,
    pub transparency: bool,
}

impl Appearance {
    pub fn from_payload(value: Value) -> Result<Self, &'static str> {
        serde_json::from_value(value).map_err(|_| "Invalid window appearance")
    }
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            theme: AppearanceTheme::Dark,
            transparency: true,
        }
    }
}

pub fn clamp_bounds(
    position: (i32, i32),
    size: (u32, u32),
    work: (i32, i32, u32, u32),
) -> ((i32, i32), (u32, u32)) {
    let width = size.0.min(work.2).max(1);
    let height = size.1.min(work.3).max(1);
    let x = (position.0 as i64).clamp(
        work.0 as i64,
        work.0 as i64 + work.2.saturating_sub(width) as i64,
    ) as i32;
    let y = (position.1 as i64).clamp(
        work.1 as i64,
        work.1 as i64 + work.3.saturating_sub(height) as i64,
    ) as i32;
    ((x, y), (width, height))
}

pub fn activation(value: &str) -> Option<Value> {
    if value.len() > 32_768 {
        return None;
    }
    let url = Url::parse(value).ok()?;
    if url.scheme() == "kb-onemail" {
        return (url.host_str() == Some("inbox")
            && matches!(url.path(), "" | "/")
            && url.query().is_none()
            && url.fragment().is_none()
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none())
        .then(|| json!({"kind":"inbox"}));
    }
    if url.scheme() != "mailto" || url.fragment().is_some() {
        return None;
    }
    let to = percent_decode(url.path())?;
    if to.contains(['\r', '\n', '\0']) {
        return None;
    }
    let mut payload = json!({"to":to});
    let mut headers = std::collections::HashSet::new();
    for pair in url
        .query()
        .unwrap_or_default()
        .split('&')
        .filter(|v| !v.is_empty())
    {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = percent_decode(key)?.to_ascii_lowercase();
        let value = percent_decode(value)?;
        if !matches!(key.as_str(), "to" | "cc" | "bcc" | "subject" | "body") {
            continue;
        }
        if value.contains('\0')
            || (key != "body" && value.contains(['\r', '\n']))
            || !headers.insert(key.clone())
        {
            return None;
        }
        if key == "to" && !to.is_empty() && !value.is_empty() {
            payload["to"] = Value::String(format!("{to},{value}"));
        } else {
            payload[key.as_str()] = Value::String(value);
        }
    }
    Some(json!({"kind":"compose", "payload":payload}))
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn retry_delay(failures: u32) -> u64 {
    if failures == 0 {
        300
    } else {
        (30u64.saturating_mul(1u64 << failures.saturating_sub(1).min(5))).min(900)
    }
}

pub struct Lifecycle {
    pub ready: bool,
    pub busy: bool,
    pub dirty: bool,
    pub pending: Option<String>,
}
impl Default for Lifecycle {
    fn default() -> Self {
        Self {
            ready: false,
            busy: true,
            dirty: true,
            pending: None,
        }
    }
}
impl Lifecycle {
    pub fn safe(&self) -> bool {
        self.ready && !self.busy && !self.dirty
    }
    pub fn approve(&mut self, id: &str, allow: bool) -> bool {
        if self.pending.as_deref() != Some(id) {
            return false;
        }
        self.pending = None;
        allow
    }
}
