//! The few words the shell says itself: the menu-bar menu. Everything else is
//! said by the interface, which has its own table (`packages/ui/src/i18n.ts`);
//! the vocabulary is the same. (The "starting…" page carries its own two lines.)

/// The languages AgentOS speaks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Language {
    #[default]
    English,
    French,
}

/// The shell's words in one language. `{agent}` stands for the agent's name.
pub struct Words {
    pub open: &'static str,
    pub side_panel: &'static str,
    pub give_screen: &'static str,
    pub add_phone: &'static str,
    pub quit: &'static str,
    /// What to call the agent before the core has told us its name.
    pub your_agent: &'static str,
}

const ENGLISH: Words = Words {
    open: "Open",
    side_panel: "Side panel",
    give_screen: "Give the screen to {agent}",
    add_phone: "Add your phone",
    quit: "Quit",
    your_agent: "your agent",
};

const FRENCH: Words = Words {
    open: "Ouvrir",
    side_panel: "Panneau latéral",
    give_screen: "Donner l'écran à {agent}",
    add_phone: "Ajouter votre téléphone",
    quit: "Quitter",
    your_agent: "votre agent",
};

impl Language {
    /// The language for a BCP-47 tag, as the core decides it: French for French speakers, English for everyone else.
    pub fn from_tag(tag: &str) -> Self {
        if tag.to_lowercase().starts_with("fr") {
            Language::French
        } else {
            Language::English
        }
    }

    /// The shell's words in this language.
    pub fn words(self) -> &'static Words {
        match self {
            Language::English => &ENGLISH,
            Language::French => &FRENCH,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn french_for_french_speakers_english_for_everyone_else() {
        assert_eq!(Language::from_tag("fr"), Language::French);
        assert_eq!(Language::from_tag("fr-CA"), Language::French);
        assert_eq!(Language::from_tag("en-GB"), Language::English);
        assert_eq!(Language::from_tag("de"), Language::English);
    }
}
