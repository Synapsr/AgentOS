//! Secrets made by the shell: the local token it gives the core it starts,
//! and the nonces it challenges a core with.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// `bytes` random bytes from the operating system's generator, as base64url text.
pub fn random(bytes: usize) -> String {
    let mut secret = vec![0; bytes];
    getrandom::fill(&mut secret).expect("the operating system provides randomness");
    URL_SAFE_NO_PAD.encode(secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_long_enough_url_safe_and_never_the_same() {
        let token = random(32);
        // 32 bytes are 43 characters of base64 without padding.
        assert_eq!(token.len(), 43);
        assert!(token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(token, random(32));
    }
}
