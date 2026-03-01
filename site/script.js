/* ===================================================================
   Snip Marketing Site — Scripts
   Scroll animations, nav behavior, mobile toggle
   =================================================================== */

(function () {
  'use strict';

  // --- Nav scroll effect ---
  var nav = document.getElementById('nav');
  var lastScroll = 0;

  function onScroll() {
    var scrollY = window.scrollY || window.pageYOffset;
    if (scrollY > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
    lastScroll = scrollY;
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
      '.feature-card, .tool-card, .ai-card, .tech-item, .step, .section-header, .ai-privacy, .hero-video-wrapper, .showcase-item, .ai-screenshot, .animate-step, .animate-demo-video-wrapper'
    );

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            // Stagger children
            var parent = entry.target.parentElement;
            if (parent) {
              var siblings = parent.querySelectorAll(
                '.feature-card, .tool-card, .ai-card, .tech-item, .step, .showcase-item, .animate-step'
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

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
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
      animateOnScroll();
      animateSectionHeaders();
      initSparkleCanvas();
      initCardGlow();
    });
  } else {
    animateOnScroll();
    animateSectionHeaders();
    initSparkleCanvas();
    initCardGlow();
  }
})();
