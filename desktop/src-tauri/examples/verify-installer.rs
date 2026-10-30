use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let installer = std::env::args().nth(1).ok_or("Expected installer path")?;
    let bytes = std::fs::read(&installer)?;
    if bytes.is_empty() {
        return Err("Installer is empty".into());
    }
    let key = STANDARD.decode(include_str!("../../updater.pub").trim())?;
    let public = PublicKey::decode(std::str::from_utf8(&key)?)?;
    let encoded = std::fs::read_to_string(format!("{installer}.sig"))?;
    let signature = STANDARD.decode(encoded.trim())?;
    let signature = Signature::decode(std::str::from_utf8(&signature)?)?;
    public.verify(&bytes, &signature, true)?;
    let mut tampered = bytes;
    tampered[0] ^= 1;
    if public.verify(&tampered, &signature, true).is_ok() {
        return Err("Tampered installer was accepted".into());
    }
    println!("Installer signature verified; tampered bytes rejected.");
    Ok(())
}
