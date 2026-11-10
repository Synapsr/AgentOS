// Generated from packages/design/tokens.json by scripts/generate.mjs. Do not edit: edit tokens.json and run `pnpm --filter @agentos/design build`.

/** Every token of tokens.json, without its notes. */
export const data = {
  "color": {
    "black": {
      "dark": "#000000",
      "light": "#000000"
    },
    "surface-stage": {
      "dark": "#0C0B0A",
      "light": "#EEECE8"
    },
    "surface": {
      "dark": "#171513",
      "light": "#F3F2F0"
    },
    "surface-raised": {
      "dark": "#25221E",
      "light": "#FFFFFF"
    },
    "surface-overlay": {
      "dark": "#302C28",
      "light": "#FFFFFF"
    },
    "line": {
      "dark": "rgba(255, 245, 235, 0.08)",
      "light": "rgba(35, 25, 15, 0.08)"
    },
    "line-strong": {
      "dark": "rgba(247, 243, 238, 0.9)",
      "light": "rgba(29, 26, 23, 0.85)"
    },
    "ring": {
      "dark": "rgba(255, 245, 235, 0.1)",
      "light": "rgba(35, 25, 15, 0.14)"
    },
    "outline": {
      "dark": "rgba(255, 255, 255, 0.1)",
      "light": "rgba(0, 0, 0, 0.1)"
    },
    "text": {
      "dark": "#F7F3EE",
      "light": "#1D1A17"
    },
    "text-dim": {
      "dark": "rgba(247, 243, 238, 0.7)",
      "light": "rgba(29, 26, 23, 0.68)"
    },
    "text-faint": {
      "dark": "rgba(247, 243, 238, 0.42)",
      "light": "rgba(29, 26, 23, 0.42)"
    },
    "fill": {
      "dark": "rgba(255, 245, 235, 0.09)",
      "light": "rgba(35, 25, 15, 0.07)"
    },
    "fill-strong": {
      "dark": "rgba(255, 245, 235, 0.14)",
      "light": "rgba(35, 25, 15, 0.11)"
    },
    "primary": {
      "dark": "#F4EEE6",
      "light": "#24201C"
    },
    "primary-top": {
      "dark": "#FFFCF8",
      "light": "#35302B"
    },
    "primary-bottom": {
      "dark": "#ECE5DB",
      "light": "#1C1916"
    },
    "primary-highlight": {
      "dark": "rgba(255, 255, 255, 0.9)",
      "light": "rgba(255, 255, 255, 0.16)"
    },
    "on-primary": {
      "dark": "#1D1A17",
      "light": "#FBF8F4"
    },
    "primary-check": {
      "dark": "#1E8A4C",
      "light": "#4FD18B"
    },
    "working": {
      "dark": "#6CB4FF",
      "light": "#1A63C0"
    },
    "working-fill": {
      "dark": "rgba(108, 180, 255, 0.14)",
      "light": "rgba(26, 99, 192, 0.1)"
    },
    "waiting": {
      "dark": "#FFB547",
      "light": "#965600"
    },
    "waiting-fill": {
      "dark": "rgba(255, 181, 71, 0.14)",
      "light": "rgba(232, 144, 12, 0.12)"
    },
    "asking-light": {
      "dark": "#FFB547",
      "light": "#E8900C"
    },
    "go": {
      "dark": "#4FD18B",
      "light": "#1E8A4C"
    },
    "go-fill": {
      "dark": "rgba(79, 209, 139, 0.16)",
      "light": "rgba(30, 138, 76, 0.1)"
    },
    "careful": {
      "dark": "#FF8E80",
      "light": "#B02E25"
    },
    "careful-fill": {
      "dark": "rgba(255, 142, 128, 0.12)",
      "light": "rgba(176, 46, 37, 0.08)"
    },
    "careful-fill-strong": {
      "dark": "rgba(255, 142, 128, 0.16)",
      "light": "rgba(176, 46, 37, 0.12)"
    },
    "focus": {
      "dark": "#6CB4FF",
      "light": "#1A63C0"
    },
    "scrim": {
      "dark": "rgba(8, 6, 4, 0.62)",
      "light": "rgba(35, 25, 15, 0.28)"
    },
    "glass": {
      "dark": "rgba(40, 36, 32, 0.72)",
      "light": "rgba(255, 255, 255, 0.72)"
    }
  },
  "alias": {
    "stop": "careful",
    "stop-fill": "careful-fill",
    "stop-fill-strong": "careful-fill-strong",
    "on-go": "on-primary"
  },
  "presence": {
    "idle": {
      "dark": {
        "from": "#FFFCF7",
        "to": "#E7DDD0",
        "core": "#FFFFFF",
        "halo": "#FFE6C7",
        "glow": 0.22
      },
      "light": {
        "from": "#1E1C1A",
        "to": "#34302D",
        "core": "#B8B2AC",
        "halo": "#1E1C1A",
        "glow": 0
      }
    },
    "working": {
      "dark": {
        "from": "#62A8FF",
        "to": "#46D3C5",
        "core": "#E2F4FF",
        "halo": "#55B8F0",
        "glow": 0.36
      },
      "light": {
        "from": "#2F7FE6",
        "to": "#12A39A",
        "core": "#8CC8FF",
        "halo": "#2F7FE6",
        "glow": 0.16
      }
    },
    "waiting": {
      "dark": {
        "from": "#FFC75C",
        "to": "#FF9B3F",
        "core": "#FFF1CF",
        "halo": "#FFAA47",
        "glow": 0.42
      },
      "light": {
        "from": "#F29A12",
        "to": "#E2700A",
        "core": "#FFD68A",
        "halo": "#F29A12",
        "glow": 0.2
      }
    },
    "listening": {
      "dark": {
        "from": "#FFFFFF",
        "to": "#D7ECFF",
        "core": "#FFFFFF",
        "halo": "#BFDDFF",
        "glow": 0.3
      },
      "light": {
        "from": "#1E1C1A",
        "to": "#262C36",
        "core": "#A9BDD8",
        "halo": "#1E1C1A",
        "glow": 0
      }
    },
    "speaking": {
      "dark": {
        "from": "#FFFFFF",
        "to": "#FFE4D1",
        "core": "#FFFFFF",
        "halo": "#FFD3B5",
        "glow": 0.3
      },
      "light": {
        "from": "#1E1C1A",
        "to": "#322B27",
        "core": "#D9BFAE",
        "halo": "#1E1C1A",
        "glow": 0
      }
    },
    "offline": {
      "dark": {
        "from": "#5F5953",
        "to": "#4C4743",
        "core": "#6B655F",
        "halo": "#5F5953",
        "glow": 0
      },
      "light": {
        "from": "#BDB7B1",
        "to": "#CBC6C0",
        "core": "#D6D1CB",
        "halo": "#BDB7B1",
        "glow": 0
      }
    },
    "via": {
      "dark": "#FFFCF7",
      "light": "#24201C"
    },
    "stage-light": {
      "opacity": 0.1,
      "spread": 2.2
    }
  },
  "font": {
    "web": {
      "brand": "Figtree, -apple-system, BlinkMacSystemFont, system-ui, \"Segoe UI\", Roboto, sans-serif",
      "text": "Figtree, -apple-system, BlinkMacSystemFont, system-ui, \"Segoe UI\", Roboto, sans-serif",
      "display": "Figtree, -apple-system, BlinkMacSystemFont, system-ui, \"Segoe UI\", Roboto, sans-serif",
      "mono": "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    },
    "apple": {
      "text": "default",
      "display": "rounded",
      "mono": "monospaced"
    },
    "file": {
      "path": "fonts/figtree.woff2",
      "family": "Figtree",
      "weights": [
        300,
        600
      ]
    }
  },
  "type": {
    "display-xl": {
      "size": 56,
      "line": 1.04,
      "weight": 360,
      "tracking": -0.028,
      "voice": "display",
      "apple": "largeTitle"
    },
    "display-l": {
      "size": 44,
      "line": 1.08,
      "weight": 380,
      "tracking": -0.024,
      "voice": "display",
      "apple": "largeTitle"
    },
    "display-m": {
      "size": 34,
      "line": 1.12,
      "weight": 400,
      "tracking": -0.02,
      "voice": "display",
      "apple": "title"
    },
    "display-s": {
      "size": 28,
      "line": 1.16,
      "weight": 400,
      "tracking": -0.016,
      "voice": "display",
      "apple": "title2"
    },
    "title-l": {
      "size": 24,
      "line": 1.25,
      "weight": 600,
      "tracking": -0.014,
      "voice": "text",
      "apple": "title2"
    },
    "title": {
      "size": 20,
      "line": 1.3,
      "weight": 600,
      "tracking": -0.01,
      "voice": "text",
      "apple": "title3"
    },
    "body-l": {
      "size": 18,
      "line": 1.5,
      "weight": 400,
      "tracking": -0.004,
      "voice": "text",
      "apple": "body"
    },
    "body": {
      "size": 16,
      "line": 1.5,
      "weight": 400,
      "tracking": 0,
      "voice": "text",
      "apple": "body"
    },
    "body-strong": {
      "size": 16,
      "line": 1.4,
      "weight": 600,
      "tracking": 0,
      "voice": "text",
      "apple": "headline"
    },
    "small": {
      "size": 15,
      "line": 1.45,
      "weight": 400,
      "tracking": 0,
      "voice": "text",
      "apple": "subheadline"
    },
    "label": {
      "size": 14,
      "line": 1.3,
      "weight": 600,
      "tracking": 0,
      "voice": "text",
      "apple": "footnote"
    },
    "caption": {
      "size": 13,
      "line": 1.35,
      "weight": 500,
      "tracking": 0.004,
      "voice": "text",
      "apple": "caption"
    },
    "button": {
      "size": 16,
      "line": 1.2,
      "weight": 600,
      "tracking": 0,
      "voice": "text",
      "apple": "body"
    },
    "button-big": {
      "size": 17,
      "line": 1.2,
      "weight": 600,
      "tracking": 0,
      "voice": "text",
      "apple": "body"
    },
    "name-large": {
      "size": 20,
      "line": 1.3,
      "weight": 500,
      "tracking": 0,
      "voice": "text",
      "apple": "title3"
    },
    "code": {
      "size": 14,
      "line": 1.5,
      "weight": 400,
      "tracking": 0,
      "voice": "mono",
      "apple": "callout"
    }
  },
  "space": {
    "2": 2,
    "4": 4,
    "8": 8,
    "12": 12,
    "16": 16,
    "20": 20,
    "24": 24,
    "32": 32,
    "44": 44,
    "64": 64,
    "96": 96
  },
  "radius": {
    "s": 10,
    "m": 16,
    "l": 22,
    "xl": 28,
    "xxl": 36,
    "full": 999
  },
  "size": {
    "control": 44,
    "control-sm": 36,
    "control-lg": 52,
    "control-big": 56,
    "control-xl": 64,
    "row": 64,
    "row-single": 52,
    "icon": 20,
    "icon-dense": 16,
    "icon-large": 24,
    "icon-tile": 32,
    "icon-stroke": 1.75,
    "measure": 680,
    "measure-narrow": 560,
    "panel": 380
  },
  "control": {
    "press": 0.96,
    "hover": 0.88,
    "hover-overlay": 0.06,
    "press-overlay": 0.08,
    "disabled": 0.4,
    "touch-guard": 400
  },
  "elevation": {
    "raised": {
      "dark": {
        "ring": "rgba(255, 245, 235, 0.07)",
        "highlight": "rgba(255, 250, 245, 0.06)",
        "shadows": [
          [
            0,
            1,
            2,
            0,
            "rgba(0, 0, 0, 0.3)"
          ],
          [
            0,
            8,
            24,
            -12,
            "rgba(0, 0, 0, 0.55)"
          ]
        ]
      },
      "light": {
        "ring": "rgba(35, 25, 15, 0.07)",
        "highlight": "rgba(255, 255, 255, 0)",
        "shadows": [
          [
            0,
            1,
            2,
            0,
            "rgba(35, 25, 15, 0.06)"
          ],
          [
            0,
            6,
            16,
            -8,
            "rgba(35, 25, 15, 0.12)"
          ]
        ]
      }
    },
    "overlay": {
      "dark": {
        "ring": "rgba(255, 245, 235, 0.09)",
        "highlight": "rgba(255, 250, 245, 0.08)",
        "shadows": [
          [
            0,
            2,
            6,
            0,
            "rgba(0, 0, 0, 0.35)"
          ],
          [
            0,
            24,
            64,
            -16,
            "rgba(0, 0, 0, 0.7)"
          ]
        ]
      },
      "light": {
        "ring": "rgba(35, 25, 15, 0.08)",
        "highlight": "rgba(255, 255, 255, 0)",
        "shadows": [
          [
            0,
            2,
            6,
            0,
            "rgba(35, 25, 15, 0.06)"
          ],
          [
            0,
            24,
            64,
            -16,
            "rgba(35, 25, 15, 0.22)"
          ]
        ]
      }
    },
    "button": {
      "dark": {
        "ring": "rgba(255, 255, 255, 0.1)",
        "highlight": "rgba(255, 255, 255, 0.9)",
        "shadows": [
          [
            0,
            1,
            2,
            0,
            "rgba(0, 0, 0, 0.35)"
          ],
          [
            0,
            6,
            16,
            -6,
            "rgba(0, 0, 0, 0.45)"
          ]
        ]
      },
      "light": {
        "ring": "rgba(0, 0, 0, 0.2)",
        "highlight": "rgba(255, 255, 255, 0.16)",
        "shadows": [
          [
            0,
            1,
            2,
            0,
            "rgba(35, 25, 15, 0.2)"
          ],
          [
            0,
            6,
            16,
            -6,
            "rgba(35, 25, 15, 0.35)"
          ]
        ]
      }
    }
  },
  "material": {
    "glass-blur": 24,
    "glass-saturate": 1.5,
    "asking-edge": 0.55,
    "asking-wash": 0.07
  },
  "stage": {
    "os": {
      "height": 0.56,
      "width": 0.9,
      "min": 160,
      "max": 600
    },
    "os-asking": {
      "height": 0.24,
      "width": 0.9,
      "min": 120,
      "max": 260
    },
    "home": {
      "height": 0.3,
      "width": 1,
      "min": 160,
      "max": 300
    },
    "home-beside": {
      "height": 0.5,
      "width": 0.72,
      "min": 160,
      "max": 440
    },
    "home-asking": 96,
    "onboarding": {
      "height": 0.3,
      "width": 1,
      "min": 140,
      "max": 240
    },
    "watch": 120,
    "watch-asking": 36,
    "panel": 80,
    "panel-asking": 48,
    "row": 32,
    "inline": 24,
    "label": 20
  },
  "motion": {
    "duration": {
      "instant": 80,
      "fast": 120,
      "exit": 150,
      "base": 200,
      "slow": 400
    },
    "ease": {
      "out": [
        0.2,
        0,
        0,
        1
      ],
      "in": [
        0.4,
        0,
        1,
        1
      ],
      "in-out": [
        0.45,
        0,
        0.2,
        1
      ]
    },
    "spring": {
      "snappy": {
        "duration": 0.25,
        "bounce": 0
      },
      "press": {
        "duration": 0.3,
        "bounce": 0.15
      },
      "layout": {
        "duration": 0.45,
        "bounce": 0
      },
      "gesture": {
        "duration": 0.5,
        "bounce": 0.25
      },
      "material": {
        "duration": 0.6,
        "bounce": 0
      }
    },
    "arrive": {
      "y": 12,
      "blur": 4,
      "stagger": 60,
      "spring": "gesture"
    },
    "leave": {
      "y": -8,
      "blur": 2,
      "duration": 150,
      "ease": "in"
    },
    "icon-swap": {
      "scale": 0.25,
      "blur": 4,
      "spring": "snappy"
    },
    "resolve": {
      "check": 0,
      "others": 120,
      "fold": 600
    },
    "line": {
      "out": 120,
      "in": 200
    }
  },
  "haptic": {
    "request-arrives": {
      "ios": "impact.light",
      "watch": "notification"
    },
    "approved": {
      "ios": "notification.success",
      "watch": "success"
    },
    "stopped": {
      "ios": "impact.rigid",
      "watch": "stop"
    },
    "failed": {
      "ios": "notification.error",
      "watch": "retry"
    },
    "phone-added": {
      "ios": "notification.success",
      "watch": "success"
    }
  }
} as const;
