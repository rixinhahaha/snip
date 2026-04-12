/* ===================================================================
   Snip Marketing Site — Scripts
   Scroll animations, nav behavior, mobile toggle
   =================================================================== */

(function () {
  'use strict';

  // --- Download constants ---
  var REPO = 'rixinhahaha/snip';
  var FALLBACK_URL = 'https://github.com/' + REPO + '/releases/latest';

  // --- Platform detection ---
  // Note: Firefox and Chrome freeze navigator.platform to "Linux x86_64" on
  // all Linux builds (including ARM64) for fingerprinting reduction, so we
  // cannot reliably detect ARM vs x86. We show both Linux downloads instead.
  function detectPlatform() {
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';
    var isMac = /Mac/.test(platform) || /Macintosh/.test(ua);
    var isLinux = /Linux/.test(platform) || /Linux/.test(ua);

    if (isMac) return 'mac-arm64';
    if (isLinux) return 'linux';
    return 'unknown';
  }

  var PLATFORMS = {
    'mac-arm64': {
      pattern: /Snip-.*-arm64\.dmg$/,
      label: 'Download for macOS (Apple Silicon)',
      note: '<span style="font-size:0.95rem;color:#cbd5e1;">Then run <code style="background:rgba(139,92,246,0.25);padding:2px 8px;border-radius:4px;color:#e2e8f0;margin:0 4px;">snip setup</code> or open the app to get started.</span><br><span style="display:inline-block;margin-top:16px;">Requires macOS 14+ (Apple Silicon). Free and open source.</span>',
      ctaNote: 'Requires macOS 14+ with Apple M-series chip.',
      showBrew: true
    },
    'linux': {
      pattern: /Snip-.*-x86_64\.AppImage$/,
      altPattern: /Snip-.*-arm64\.deb$/,
      label: 'Download for Linux (x86_64)',
      altLabel: 'Download for Linux (ARM64 .deb)',
      note: 'Linux AppImage — x86_64 and ARM64. Free and open source.',
      ctaNote: 'Linux x86_64 & ARM64. Free and open source.',
      showBrew: false
    },
    'unknown': {
      pattern: null,
      label: 'Download from GitHub',
      note: 'Free and open source.',
      ctaNote: 'Free and open source.',
      showBrew: false
    }
  };

  var PLATFORM = PLATFORMS[detectPlatform()];

  // --- Nav scroll effect ---
  var nav = document.getElementById('nav');
  function onScroll() {
    var scrollY = window.scrollY || window.pageYOffset;
    if (scrollY > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- Mobile nav toggle ---
  var toggle = document.getElementById('nav-toggle');
  var links = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      var isOpen = links.classList.contains('open');
      toggle.setAttribute('aria-expanded', isOpen);
    });

    // Close on link click
    var navAnchors = links.querySelectorAll('a');
    for (var i = 0; i < navAnchors.length; i++) {
      navAnchors[i].addEventListener('click', function () {
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    }
  }

  // --- Scroll-triggered animations ---
  function animateOnScroll() {
    var elements = document.querySelectorAll(
      '.feature-card, .tool-card, .ai-card, .tech-item, .step, .section-header, .ai-privacy, .hero-video-wrapper, .showcase-item, .ai-screenshot, .animate-step, .animate-demo-video-wrapper, .segment-tag-step, .segment-tag-video-wrapper, .upscale-step, .upscale-demo-video-wrapper, .transcribe-step, .transcribe-demo-video-wrapper, .mcp-demo-video-wrapper, .mcp-tool-card, .mcp-setup, .extension-point'
    );

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            // Stagger children
            var parent = entry.target.parentElement;
            if (parent) {
              var siblings = parent.querySelectorAll(
                '.feature-card, .tool-card, .ai-card, .tech-item, .step, .showcase-item, .animate-step, .segment-tag-step, .upscale-step, .transcribe-step'
              );
              var index = Array.prototype.indexOf.call(siblings, entry.target);
              if (index >= 0) {
                entry.target.style.transitionDelay = (index * 0.08) + 's';
              }
            }
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px',
      }
    );

    elements.forEach(function (el) {
      observer.observe(el);
    });
  }

  // --- Section headers fade in ---
  function animateSectionHeaders() {
    var headers = document.querySelectorAll('.section-header');
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    headers.forEach(function (el) {
      el.classList.add('fade-in');
      observer.observe(el);
    });
  }

  // --- Populate download links ---
  function setDownloadHref(url) {
    document.querySelectorAll('.download-link').forEach(function (link) {
      link.href = url;
    });
  }

  function setDownloadLabel(text) {
    document.querySelectorAll('.download-link').forEach(function (link) {
      var svg = link.querySelector('svg');
      link.textContent = '';
      if (svg) link.appendChild(svg);
      link.appendChild(document.createTextNode(' ' + text));
    });
  }

  function initDownloadLinks() {
    // Set label and fallback URL immediately
    setDownloadHref(FALLBACK_URL);
    setDownloadLabel(PLATFORM.label);

    // Update hero notes
    var heroNotes = document.querySelectorAll('.hero-note');
    if (heroNotes.length >= 1) heroNotes[0].innerHTML = PLATFORM.note;
    if (heroNotes.length >= 2) heroNotes[1].innerHTML = PLATFORM.ctaNote;

    // Show/hide brew install (macOS only)
    var brewInstall = document.querySelector('.brew-install');
    if (brewInstall) brewInstall.style.display = PLATFORM.showBrew ? '' : 'none';

    // Show alt download button + "all platforms" link for Linux
    if (PLATFORM.altPattern) {
      document.querySelectorAll('.download-link-alt').forEach(function (link) {
        link.style.display = '';
        var svg = link.querySelector('svg');
        link.textContent = '';
        if (svg) link.appendChild(svg);
        link.appendChild(document.createTextNode(' ' + PLATFORM.altLabel));
        link.href = FALLBACK_URL;
      });
      document.querySelectorAll('.all-platforms-link').forEach(function (el) {
        el.style.display = '';
      });
    }

    // Fetch latest release asset for this platform
    if (!PLATFORM.pattern) return;

    fetch('https://api.github.com/repos/' + REPO + '/releases/latest')
      .then(function (res) { return res.json(); })
      .then(function (release) {
        var assets = release.assets || [];
        var asset = assets.find(function (a) {
          return PLATFORM.pattern.test(a.name);
        });
        if (asset && asset.browser_download_url) {
          setDownloadHref(asset.browser_download_url);
        }
        // Set alt download link (ARM64 for Linux)
        if (PLATFORM.altPattern) {
          var altAsset = assets.find(function (a) {
            return PLATFORM.altPattern.test(a.name);
          });
          if (altAsset && altAsset.browser_download_url) {
            document.querySelectorAll('.download-link-alt').forEach(function (link) {
              link.href = altAsset.browser_download_url;
            });
          }
        }
      })
      .catch(function () {
        // Fallback URL already set
      });
  }

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    // Skip download links — their href gets updated dynamically
    if (anchor.classList.contains('download-link')) return;
    anchor.addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      if (href === '#') return;
      e.preventDefault();
      var target = document.querySelector(href);
      if (target) {
        var offset = 80;
        var position = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: position, behavior: 'smooth' });
      }
    });
  });

  // --- Ambient sparkle particle canvas ---
  function initSparkleCanvas() {
    var canvas = document.getElementById('sparkle-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var particles = [];
    var PARTICLE_COUNT = 40;
    var colors = [
      [147, 197, 253],  // #93c5fd
      [165, 180, 252],  // #a5b4fc
      [196, 181, 253],  // #c4b5fd
      [129, 140, 248],  // #818cf8
      [139, 92, 246]    // #8B5CF6
    ];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create particles
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(createParticle());
    }

    function createParticle() {
      var color = colors[Math.floor(Math.random() * colors.length)];
      return {
        x: Math.random() * (canvas.width || 1280),
        y: Math.random() * (canvas.height || 800),
        size: Math.random() * 1.8 + 0.4,
        speedY: -(Math.random() * 0.12 + 0.03),
        speedX: (Math.random() - 0.5) * 0.1,
        drift: Math.random() * Math.PI * 2,
        driftSpeed: Math.random() * 0.003 + 0.001,
        opacity: Math.random() * 0.4 + 0.05,
        targetOpacity: Math.random() * 0.5 + 0.1,
        r: color[0], g: color[1], b: color[2],
        isStar: Math.random() > 0.7
      };
    }

    function drawStar(x, y, size, r, g, b, opacity) {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + opacity + ')';
      ctx.beginPath();
      var spikes = 4;
      var outerR = size * 2.5;
      var innerR = size * 0.8;
      for (var i = 0; i < spikes * 2; i++) {
        var angle = (i * Math.PI) / spikes - Math.PI / 2;
        var radius = i % 2 === 0 ? outerR : innerR;
        if (i === 0) {
          ctx.moveTo(radius * Math.cos(angle), radius * Math.sin(angle));
        } else {
          ctx.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];

        // Twinkle toward target opacity
        p.opacity += (p.targetOpacity - p.opacity) * 0.015;
        if (Math.abs(p.opacity - p.targetOpacity) < 0.01) {
          p.targetOpacity = Math.random() * 0.5 + 0.05;
        }

        // Gentle drift
        p.drift += p.driftSpeed;
        p.x += p.speedX + Math.sin(p.drift) * 0.15;
        p.y += p.speedY;

        // Wrap around
        if (p.y < -10) {
          p.y = canvas.height + 10;
          p.x = Math.random() * canvas.width;
        }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;

        // Draw
        if (p.isStar) {
          drawStar(p.x, p.y, p.size, p.r, p.g, p.b, p.opacity);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + p.opacity + ')';
          ctx.fill();
        }
      }

      requestAnimationFrame(animate);
    }

    // Use reduced motion if user prefers
    var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReduced) {
      animate();
    }
  }

  // --- Mouse proximity glow on feature cards ---
  function initCardGlow() {
    var cards = document.querySelectorAll('.feature-card');
    cards.forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        card.style.setProperty('--glow-x', x + 'px');
        card.style.setProperty('--glow-y', y + 'px');
      });
    });
  }

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initDownloadLinks();
      animateOnScroll();
      animateSectionHeaders();
      initSparkleCanvas();
      initCardGlow();
    });
  } else {
    initDownloadLinks();
    animateOnScroll();
    animateSectionHeaders();
    initSparkleCanvas();
    initCardGlow();
  }
})();
