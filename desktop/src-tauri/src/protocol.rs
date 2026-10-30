use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use url::Url;

pub const HOST: &str = "betterbox.kevinjbridgelal.workers.dev";
pub const ORIGIN: &str = "https://betterbox.kevinjbridgelal.workers.dev";

pub fn trusted(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(HOST)
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn safe_external(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn safe_download(url: &Url) -> bool {
    trusted(url)
        || (url.scheme() == "blob"
            && url
                .as_str()
                .strip_prefix("blob:")
                .and_then(|value| Url::parse(value).ok())
                .is_some_and(|inner| trusted(&inner)))
}

pub fn valid_mode(mode: &str) -> bool {
    matches!(mode, "signin" | "google" | "google-settings" | "github")
}

pub fn new_verifier() -> (String, String) {
    let mut random = [0u8; 32];
    OsRng.fill_bytes(&mut random);
    let verifier = URL_SAFE_NO_PAD.encode(random);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub fn valid_browser_url(value: &str, id: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        trusted(&url)
            && url.path() == "/desktop/connect"
            && url.fragment().is_none()
            && url.query_pairs().collect::<Vec<_>>() == vec![("id".into(), id.into())]
    })
}

#[derive(Clone, Deserialize)]
pub struct SessionCookie {
    pub name: String,
    pub value: String,
    pub expires: String,
}

pub fn session_cookie(value: &SessionCookie) -> Result<cookie::Cookie<'static>, &'static str> {
    if !matches!(
        value.name.as_str(),
        "__Secure-better-auth.session_token" | "better-auth.session_token"
    ) || value.value.is_empty()
        || value.value.len() > 4096
        || !value
            .value
            .bytes()
            .all(|b| matches!(b, 0x21 | 0x23..=0x2b | 0x2d..=0x3a | 0x3c..=0x5b | 0x5d..=0x7e))
    {
        return Err("The desktop session response was invalid. Start sign-in again.");
    }
    let expires = OffsetDateTime::parse(&value.expires, &Rfc3339)
        .map_err(|_| "The desktop session expiry was invalid.")?;
    if expires <= OffsetDateTime::now_utc() {
        return Err("The desktop session expired. Start sign-in again.");
    }
    Ok(
        cookie::Cookie::build((value.name.clone(), value.value.clone()))
            .domain(HOST)
            .path("/")
            .secure(true)
            .http_only(true)
            .same_site(cookie::SameSite::Lax)
            .expires(expires)
            .build(),
    )
}

pub fn redeem_status(status: u16) -> Result<bool, &'static str> {
    match status {
        200 => Ok(true),
        202 => Ok(false),
        410 => Err("This sign-in request expired or was used. Start again in BetterBox."),
        403 => Err("This sign-in request was rejected. Start again in BetterBox."),
        _ => Err("BetterBox could not complete sign-in. Start again in BetterBox."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_is_exact_https_origin_without_credentials() {
        for value in [ORIGIN.to_owned(), format!("{ORIGIN}/mail?q=x")] {
            assert!(trusted(&url::Url::parse(&value).unwrap()));
        }
        for value in [
            "http://betterbox.kevinjbridgelal.workers.dev/",
            "https://betterbox.kevinjbridgelal.workers.dev.evil.test/",
            "https://betterbox.kevinjbridgelal.workers.dev:444/",
            "https://user@betterbox.kevinjbridgelal.workers.dev/",
            "https://accounts.google.com/",
        ] {
            assert!(!trusted(&url::Url::parse(value).unwrap()), "{value}");
        }
    }

    #[test]
    fn browser_handoff_must_match_ticket_and_exact_path() {
        let valid = format!("{ORIGIN}/desktop/connect?id=ticket-1");
        assert!(valid_browser_url(&valid, "ticket-1"));
        assert!(!valid_browser_url(&valid, "ticket-2"));
        assert!(!valid_browser_url(
            &format!("{valid}&next=evil"),
            "ticket-1"
        ));
        assert!(!valid_browser_url(&format!("{valid}#secret"), "ticket-1"));
        assert!(!valid_browser_url(
            "https://accounts.google.com/desktop/connect?id=ticket-1",
            "ticket-1"
        ));
    }

    #[test]
    fn verifier_uses_32_random_bytes_and_sha256_challenge() {
        let (verifier, challenge) = new_verifier();
        assert_eq!(URL_SAFE_NO_PAD.decode(&verifier).unwrap().len(), 32);
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );
        assert_ne!(verifier, new_verifier().0);
    }

    #[test]
    fn returned_cookie_is_bounded_to_session_name_and_future_expiry() {
        let valid = SessionCookie {
            name: "__Secure-better-auth.session_token".into(),
            value: "signed.session_value-123".into(),
            expires: "2099-01-01T00:00:00Z".into(),
        };
        let cookie = session_cookie(&valid).unwrap();
        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.secure(), Some(true));
        assert_eq!(cookie.same_site(), Some(cookie::SameSite::Lax));
        assert_eq!(cookie.domain(), Some(HOST));
        assert_eq!(cookie.path(), Some("/"));
        assert!(session_cookie(&SessionCookie {
            name: "other".into(),
            ..valid.clone()
        })
        .is_err());
        assert!(session_cookie(&SessionCookie {
            value: "bad;cookie".into(),
            ..valid.clone()
        })
        .is_err());
        assert!(session_cookie(&SessionCookie {
            expires: "2000-01-01T00:00:00Z".into(),
            ..valid
        })
        .is_err());
    }

    #[test]
    fn only_supported_modes_and_safe_browser_schemes() {
        assert!(valid_mode("signin"));
        assert!(valid_mode("google-settings"));
        assert!(!valid_mode("https://evil.test"));
        assert!(!safe_external(
            &url::Url::parse("javascript:alert(1)").unwrap()
        ));
        assert!(!safe_external(
            &url::Url::parse("file:///C:/secret").unwrap()
        ));
        assert!(safe_external(
            &url::Url::parse("https://example.com/path").unwrap()
        ));
        assert!(safe_external(
            &url::Url::parse("http://example.com/path").unwrap()
        ));
        assert!(!safe_external(
            &url::Url::parse("https://user:secret@example.com/").unwrap()
        ));
    }

    #[test]
    fn redeem_status_only_retries_pending_and_rejects_failure() {
        assert_eq!(redeem_status(202), Ok(false));
        assert_eq!(redeem_status(200), Ok(true));
        for code in [301, 400, 401, 403, 404, 410, 429, 500] {
            assert!(redeem_status(code).is_err(), "{code}");
        }
    }

    #[test]
    fn downloads_reject_foreign_origins_and_local_files() {
        assert!(safe_download(
            &Url::parse(&format!("{ORIGIN}/api/gmail/attachment")).unwrap()
        ));
        assert!(safe_download(
            &Url::parse(&format!("blob:{ORIGIN}/attachment-id")).unwrap()
        ));
        for value in [
            "blob:https://evil.test/id",
            "file:///C:/private.txt",
            "https://evil.test/download.exe",
        ] {
            assert!(!safe_download(&Url::parse(value).unwrap()), "{value}");
        }
    }
}
