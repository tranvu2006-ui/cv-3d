/**
 * Trần Vũ's WebAR CV2 - Hand Tracking Script
 * Integrates Google MediaPipe Hands with Three.js to render CV cards on the user's hand.
 * Handles webcam initialization, coordinate projection, skeleton rendering, and gestures.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // ==========================================================================
  // DOM ELEMENTS & OVERLAYS
  // ==========================================================================
  const webcamVideo = document.getElementById('webcam');
  const canvas3d = document.getElementById('canvas3d');
  const loadingOverlay = document.getElementById('loading-overlay');
  
  const scanStatus = document.getElementById('scan-status');
  const statusText = document.getElementById('status-text');
  
  let eyeOffIcon = null;
  let eyeOnIcon = null;
  if (scanStatus) {
    eyeOffIcon = scanStatus.querySelector('.status-icon-lost');
    eyeOnIcon = scanStatus.querySelector('.status-icon-found');
  }

  // ==========================================================================
  // THREE.JS SETUP
  // ==========================================================================
  let scene, camera, renderer;
  let jointSpheres = [];
  let arGroup; // Parent group for CV cards
  let coreMesh; // Central rotating tech core
  let outerRingMesh; // Planetary compass ring
  let skillsCard, projectsCard, titleCard, contactCard; // Cards global reference
  
  // Gesture & Animation States
  let isCelebrating = false;
  let celebrateTime = 0;
  let gestureCooldown = false;
  const neonColors = [0x00d4ff, 0xa855f7, 0x10b981, 0xf59e0b, 0xef4444, 0xff007f];
  let currentColorIdx = 0;
  let isHackerMode = false;

  // Particle System States
  let particles;
  const particleCount = 100;
  const particleVelocities = [];
  let ambientParticles;
  const ambientCount = 60;
  const ambientVelocities = [];

  // Hand skeleton line segments
  let skeletonLines;

  // Smoothing target coordinates
  let targetPos = { x: 0, y: 0, z: 0 };
  let currentScale = 0;
  let isHandOpen = false;

  function initThree() {
    // Scene
    scene = new THREE.Scene();

    // Camera (Perspective matching screen size)
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.z = 100;

    // Renderer (Transparent canvas overlaid on webcam feed)
    renderer = new THREE.WebGLRenderer({ canvas: canvas3d, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Add Ambient Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    // Create 3D Joint spheres for Hand Skeleton visualization
    const jointGeo = new THREE.SphereGeometry(1.2, 16, 16);
    for (let i = 0; i < 21; i++) {
      let color = 0x00d4ff; // Cyan for knuckles/wrist
      if (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) {
        color = 0xa855f7; // Purple for fingertips
      }
      
      const jointMat = new THREE.MeshBasicMaterial({ color: color });
      const sphere = new THREE.Mesh(jointGeo, jointMat);
      sphere.visible = false; // Hidden until hand detected
      scene.add(sphere);
      jointSpheres.push(sphere);
    }

    // Create laser skeleton lines connecting the joints
    const skeletonConnections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17]
    ];
    const lineIndices = [];
    skeletonConnections.forEach(conn => {
      lineIndices.push(conn[0], conn[1]);
    });
    const linePositions = new Float32Array(21 * 3);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setIndex(lineIndices);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.6,
      linewidth: 2
    });
    skeletonLines = new THREE.LineSegments(lineGeometry, lineMaterial);
    skeletonLines.visible = false;
    scene.add(skeletonLines);

    // ==========================================================================
    // CREATING HOLOGRAPHIC 2D TEXTURE CARDS (Supports Vietnamese Accents)
    // ==========================================================================
    function createTextPlane(lines, width, height, borderColor) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');

      // Rounded Rectangle Background Draw
      function drawRoundedRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }

      // Fill semi-transparent dark background
      ctx.fillStyle = 'rgba(11, 15, 25, 0.85)';
      drawRoundedRect(4, 4, canvas.width - 8, canvas.height - 8, 24);
      ctx.fill();

      // Stroke Neon border
      ctx.strokeStyle = borderColor || '#00d4ff';
      ctx.lineWidth = 6;
      drawRoundedRect(4, 4, canvas.width - 8, canvas.height - 8, 24);
      ctx.stroke();

      // Text Render
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Title line (always first line)
      ctx.fillStyle = borderColor || '#00d4ff';
      ctx.font = 'bold 36px Outfit, Inter, sans-serif';
      ctx.fillText(lines[0], canvas.width / 2, 55);

      // Divider line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(40, 95);
      ctx.lineTo(canvas.width - 40, 95);
      ctx.stroke();

      // Body text lines
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '500 24px Inter, sans-serif';
      
      const bodyLines = lines.slice(1);
      const startY = 135;
      const spacing = 36;
      bodyLines.forEach((line, index) => {
        ctx.fillText(line, canvas.width / 2, startY + index * spacing);
      });

      // Map canvas to Three.js Texture
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
      const planeGeo = new THREE.PlaneGeometry(width, height);
      return new THREE.Mesh(planeGeo, material);
    }

    // AR content container
    arGroup = new THREE.Group();
    scene.add(arGroup);

    // Add Central Tech Core (Spinning sphere grid)
    const coreGeo = new THREE.SphereGeometry(3.5, 12, 12);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, wireframe: true });
    coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(0, 0, 0);
    arGroup.add(coreMesh);

    // Inner solid core with low opacity
    const innerGeo = new THREE.SphereGeometry(2.2, 16, 16);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.35 });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    coreMesh.add(innerMesh);

    // Vertical spinning ring
    const ringGeo1 = new THREE.RingGeometry(4.2, 4.6, 32);
    const ringMat1 = new THREE.MeshBasicMaterial({ color: 0x00d4ff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    const ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    coreMesh.add(ringMesh1);

    // Octagonal outer planetary compass ring
    const ringGeo2 = new THREE.RingGeometry(5.2, 5.8, 8, 1);
    const ringMat2 = new THREE.MeshBasicMaterial({ color: 0x00d4ff, side: THREE.DoubleSide, wireframe: true, transparent: true, opacity: 0.8 });
    outerRingMesh = new THREE.Mesh(ringGeo2, ringMat2);
    outerRingMesh.rotation.x = Math.PI / 2;
    arGroup.add(outerRingMesh);

    // Left Panel: Skills
    skillsCard = createTextPlane([
      "KỸ NĂNG",
      "Java / Kotlin",
      "PHP / Laravel",
      "MySQL Database",
      "Git / GitHub"
    ], 26, 13, '#a855f7');
    skillsCard.position.set(-20, 2, 0);
    skillsCard.rotation.y = 0.45; // Face inward slightly
    arGroup.add(skillsCard);

    // Right Panel: Projects
    projectsCard = createTextPlane([
      "DỰ ÁN",
      "Quản Lý Kho (Java)",
      "Web Bán Hàng (PHP)",
      "App Android (Kotlin)"
    ], 26, 13, '#00d4ff');
    projectsCard.position.set(20, 2, 0);
    projectsCard.rotation.y = -0.45; // Face inward slightly
    arGroup.add(projectsCard);

    // Top Panel: Title
    titleCard = createTextPlane([
      "TRẦN VŨ",
      "Sinh Viên Năm 2 (TDC)",
      "Công Nghệ Phần Mềm"
    ], 28, 14, '#ffffff');
    titleCard.position.set(0, 12, 0);
    arGroup.add(titleCard);

    // Bottom Panel: Contact
    contactCard = createTextPlane([
      "LIÊN HỆ",
      "tranvuit2006@gmail.com",
      "github.com/tranvu2006-ui"
    ], 28, 14, '#10b981');
    contactCard.position.set(0, -11, 2);
    contactCard.rotation.x = -0.3; // Tilt upward
    arGroup.add(contactCard);

    // Construct Particle System for Particle Blast Action
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = 0;
      particlePositions[i * 3 + 1] = 0;
      particlePositions[i * 3 + 2] = 0;
      particleVelocities.push(new THREE.Vector3(0, 0, 0));
      
      particleColors[i * 3] = 1;
      particleColors[i * 3 + 1] = 1;
      particleColors[i * 3 + 2] = 1;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    // Circular glowing point texture using canvas
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 16;
    pCanvas.height = 16;
    const pCtx = pCanvas.getContext('2d');
    const grad = pCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, 16, 16);
    const pTexture = new THREE.CanvasTexture(pCanvas);

    const particleMaterial = new THREE.PointsMaterial({
      size: 2.5,
      map: pTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true
    });

    particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.visible = false;
    arGroup.add(particles);

    // Construct Ambient Hologram Floating Particles
    const ambientGeometry = new THREE.BufferGeometry();
    const ambientPositions = new Float32Array(ambientCount * 3);

    for (let i = 0; i < ambientCount; i++) {
      ambientPositions[i * 3] = (Math.random() - 0.5) * 45;
      ambientPositions[i * 3 + 1] = -15 + Math.random() * 30;
      ambientPositions[i * 3 + 2] = (Math.random() - 0.5) * 25;
      ambientVelocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.05,
        0.04 + Math.random() * 0.08,
        (Math.random() - 0.5) * 0.05
      ));
    }

    ambientGeometry.setAttribute('position', new THREE.BufferAttribute(ambientPositions, 3));

    const ambientMaterial = new THREE.PointsMaterial({
      size: 0.9,
      map: pTexture, // Share the glowing texture
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0x00d4ff
    });

    ambientParticles = new THREE.Points(ambientGeometry, ambientMaterial);
    arGroup.add(ambientParticles);

    // Hide AR group by default
    arGroup.visible = false;
    arGroup.scale.set(0, 0, 0);

    window.addEventListener('resize', onWindowResize);
    
    // Start Animation Loop
    animate();
  }

  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function animate() {
    requestAnimationFrame(animate);

    try {
      // Slow rotation of central core mesh (spins faster in Hacker Mode!)
      if (coreMesh) {
        const spinSpeed = isHackerMode ? 0.08 : 0.008;
        coreMesh.rotation.y += spinSpeed;
        coreMesh.rotation.x += spinSpeed * 0.4;
      }

      // Counter-rotate the outer planetary ring
      if (outerRingMesh) {
        const ringSpeed = isHackerMode ? -0.06 : -0.006;
        outerRingMesh.rotation.z += ringSpeed;
      }

      // Celebrate bounce animation (gợn sóng) khi có cử chỉ LIKE
      if (isCelebrating && skillsCard && projectsCard && titleCard && contactCard) {
        celebrateTime += 0.12;
        const wave = Math.sin(celebrateTime) * 2.5;
        skillsCard.position.y = 2 + wave;
        projectsCard.position.y = 2 - wave; 
        titleCard.position.y = 12 + wave * 0.4;
        contactCard.position.y = -11 - wave * 0.4;
      } else {
        // Bobbing drift animation for weightless hologram feel
        const bobTime = Date.now() * 0.0015;
        if (skillsCard) {
          skillsCard.position.y = 2 + Math.sin(bobTime + 0) * 0.8;
          skillsCard.position.x = -20 + Math.cos(bobTime * 0.5) * 0.3;
        }
        if (projectsCard) {
          projectsCard.position.y = 2 + Math.sin(bobTime + Math.PI) * 0.8;
          projectsCard.position.x = 20 - Math.cos(bobTime * 0.5) * 0.3;
        }
        if (titleCard) {
          titleCard.position.y = 12 + Math.sin(bobTime * 0.8 + Math.PI/2) * 0.6;
        }
        if (contactCard) {
          contactCard.position.y = -11 + Math.sin(bobTime * 0.8 - Math.PI/2) * 0.6;
        }
      }

      // Update particles for L-Sign explosion
      if (particles && particles.visible) {
        const posAttr = particles.geometry.attributes.position;
        let activeParticles = 0;
        for (let i = 0; i < particleCount; i++) {
          const vx = particleVelocities[i].x;
          const vy = particleVelocities[i].y;
          const vz = particleVelocities[i].z;

          posAttr.array[i * 3] += vx;
          posAttr.array[i * 3 + 1] += vy;
          posAttr.array[i * 3 + 2] += vz;

          // Air resistance / friction
          particleVelocities[i].multiplyScalar(0.96);

          if (particleVelocities[i].lengthSq() > 0.001) {
            activeParticles++;
          }
        }
        posAttr.needsUpdate = true;
        if (activeParticles === 0) {
          particles.visible = false;
        }
      }

      // Update ambient particles
      if (ambientParticles && arGroup.visible) {
        ambientParticles.visible = true;
        const posAttr = ambientParticles.geometry.attributes.position;
        for (let i = 0; i < ambientCount; i++) {
          posAttr.array[i * 3] += ambientVelocities[i].x;
          posAttr.array[i * 3 + 1] += ambientVelocities[i].y;
          posAttr.array[i * 3 + 2] += ambientVelocities[i].z;
          
          // Reset if floats too high
          if (posAttr.array[i * 3 + 1] > 25) {
            posAttr.array[i * 3] = (Math.random() - 0.5) * 45;
            posAttr.array[i * 3 + 1] = -15 + (Math.random() - 0.5) * 5;
            posAttr.array[i * 3 + 2] = (Math.random() - 0.5) * 25;
          }
        }
        posAttr.needsUpdate = true;
      } else if (ambientParticles) {
        ambientParticles.visible = false;
      }

      // Smooth LERP transition for AR group scale (hologram pop opening)
      if (arGroup && arGroup.visible) {
        const targetScale = isHandOpen ? 1 : 0;
        currentScale += (targetScale - currentScale) * 0.12; // Easing speed
        arGroup.scale.set(currentScale, currentScale, currentScale);
        
        if (currentScale < 0.02 && !isHandOpen) {
          arGroup.visible = false;
        }
      }

      // Smooth LERP transition for Position (keeps group floating above palm)
      if (arGroup && arGroup.visible) {
        arGroup.position.x += (targetPos.x - arGroup.position.x) * 0.18;
        arGroup.position.y += (targetPos.y - arGroup.position.y) * 0.18;
        arGroup.position.z += (targetPos.z - arGroup.position.z) * 0.18;
      }

      renderer.render(scene, camera);
    } catch (err) {
      console.error("Error in animate loop: ", err);
    }
  }

  initThree();

  // ==========================================================================
  // GOOGLE MEDIAPIPE HAND TRACKING LOGIC
  // ==========================================================================
  
  // Normalized 2D coordinates mapping to Three.js 3D space coordinates
  function mapCoordinates(x, y, z) {
    // Camera is mirrored: scaleX(-1), so x must be flipped to align coordinate systems
    const threeX = -(x - 0.5) * 110; 
    const threeY = -(y - 0.5) * 85;
    // z mapping (mediapipe z is negative closer to camera)
    const threeZ = -z * 80; 
    return { x: threeX, y: threeY, z: threeZ };
  }

  // ==========================================================================
  // GESTURE ACTION TRIGGERS & UTILITIES
  // ==========================================================================
  function showToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.position = 'fixed';
      container.style.bottom = '5rem';
      container.style.left = '50%';
      container.style.transform = 'translateX(-50%)';
      container.style.zIndex = '9999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '0.5rem';
      container.style.pointerEvents = 'none';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'glass-card toast-notification';
    toast.textContent = message;
    
    // Style toast dynamically
    toast.style.padding = '0.75rem 1.5rem';
    toast.style.borderRadius = '10px';
    toast.style.fontSize = '0.9rem';
    toast.style.fontWeight = '500';
    toast.style.color = '#fff';
    toast.style.background = 'rgba(15, 23, 42, 0.85)';
    toast.style.border = '1px solid rgba(0, 212, 255, 0.4)';
    toast.style.backdropFilter = 'blur(8px)';
    toast.style.boxShadow = '0 8px 32px 0 rgba(0, 212, 255, 0.15)';
    toast.style.pointerEvents = 'auto';
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
    toast.style.transition = 'all 0.3s ease';

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    }, 10);

    setTimeout(() => {
      toast.style.transform = 'translateY(-20px)';
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      }, 300);
    }, 3000);
  }

  function cycleCardColors() {
    currentColorIdx = (currentColorIdx + 1) % neonColors.length;
    const color = neonColors[currentColorIdx];
    
    if (skillsCard) skillsCard.material.color.setHex(color);
    if (projectsCard) projectsCard.material.color.setHex(color);
    if (titleCard) titleCard.material.color.setHex(color);
    if (contactCard) contactCard.material.color.setHex(color);
    if (coreMesh) coreMesh.material.color.setHex(color);
    if (outerRingMesh) outerRingMesh.material.color.setHex(color);
    if (skeletonLines) skeletonLines.material.color.setHex(color);
    if (ambientParticles) ambientParticles.material.color.setHex(color);
  }

  function triggerBounceAnimation() {
    isCelebrating = true;
    celebrateTime = 0;
    setTimeout(() => {
      isCelebrating = false;
      // Reset card positions to standard
      if (skillsCard) skillsCard.position.y = 2;
      if (projectsCard) projectsCard.position.y = 2;
      if (titleCard) titleCard.position.y = 12;
      if (contactCard) contactCard.position.y = -11;
    }, 3200);
  }

  function triggerParticleBlast() {
    if (!particles) return;
    particles.visible = true;
    const posAttr = particles.geometry.attributes.position;
    const colorAttr = particles.geometry.attributes.color;
    
    const currentThemeHex = neonColors[currentColorIdx];
    const r = ((currentThemeHex >> 16) & 255) / 255;
    const g = ((currentThemeHex >> 8) & 255) / 255;
    const b = (currentThemeHex & 255) / 255;

    for (let i = 0; i < particleCount; i++) {
      posAttr.array[i * 3] = coreMesh ? coreMesh.position.x : 0;
      posAttr.array[i * 3 + 1] = coreMesh ? coreMesh.position.y : 0;
      posAttr.array[i * 3 + 2] = coreMesh ? coreMesh.position.z : 0;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const speed = 0.8 + Math.random() * 2.2;

      particleVelocities[i] = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      );

      colorAttr.array[i * 3] = r;
      colorAttr.array[i * 3 + 1] = g;
      colorAttr.array[i * 3 + 2] = b;
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  function triggerHackerMode() {
    isHackerMode = true;
    const green = 0x00ff66;
    if (skillsCard) skillsCard.material.color.setHex(green);
    if (projectsCard) projectsCard.material.color.setHex(green);
    if (titleCard) titleCard.material.color.setHex(green);
    if (contactCard) contactCard.material.color.setHex(green);
    if (coreMesh) coreMesh.material.color.setHex(green);
    if (outerRingMesh) outerRingMesh.material.color.setHex(green);
    if (skeletonLines) skeletonLines.material.color.setHex(green);
    if (ambientParticles) ambientParticles.material.color.setHex(green);
    
    const scanPrompt = document.getElementById('scan-prompt');
    if (scanPrompt) {
      scanPrompt.style.borderColor = '#00ff66';
      scanPrompt.style.boxShadow = '0 0 25px rgba(0, 255, 102, 0.5)';
    }

    setTimeout(() => {
      isHackerMode = false;
      const originalColor = neonColors[currentColorIdx];
      if (skillsCard) skillsCard.material.color.setHex(originalColor);
      if (projectsCard) projectsCard.material.color.setHex(originalColor);
      if (titleCard) titleCard.material.color.setHex(originalColor);
      if (contactCard) contactCard.material.color.setHex(originalColor);
      if (coreMesh) coreMesh.material.color.setHex(originalColor);
      if (outerRingMesh) outerRingMesh.material.color.setHex(originalColor);
      if (skeletonLines) skeletonLines.material.color.setHex(originalColor);
      if (ambientParticles) ambientParticles.material.color.setHex(originalColor);
      if (scanPrompt) {
        scanPrompt.style.borderColor = '';
        scanPrompt.style.boxShadow = '';
      }
    }, 4000);
  }

  function triggerGestureAction(gesture) {
    if (gestureCooldown) return;

    if (gesture === 'OK') {
      showToast('👌 Cử chỉ OK: Đang chuyển hướng sang trang CV 2D...');
      gestureCooldown = true;
      
      const newWin = window.open('https://tranvu2006-ui.github.io/', '_blank');
      if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
        // Fallback: redirect current tab if popup is blocked
        setTimeout(() => {
          window.location.href = 'https://tranvu2006-ui.github.io/';
        }, 800); // Short delay to let the user read the toast message
      }
      setTimeout(() => gestureCooldown = false, 3000);
    } else if (gesture === 'PEACE') {
      cycleCardColors();
      showToast('✌️ Cử chỉ Victory: Đã đổi màu neon nghệ thuật!');
      gestureCooldown = true;
      setTimeout(() => gestureCooldown = false, 2500);
    } else if (gesture === 'THUMB_UP') {
      triggerBounceAnimation();
      showToast('👍 Cử chỉ Like: Cảm ơn bạn đã thích dự án!');
      gestureCooldown = true;
      setTimeout(() => gestureCooldown = false, 3500);
    }
  }

  // Detect finger gestures (Open vs Fist vs Index pointing vs Peace vs Like vs OK)
  function analyzeHandGesture(landmarks) {
    function getDistance(p1, p2) {
      return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    }

    // Joint indices: Tip vs PIP (Knuckle base)
    // Index: 8 vs 6
    // Middle: 12 vs 10
    // Ring: 16 vs 14
    // Pinky: 20 vs 18
    const isIndexClosed = landmarks[8].y > landmarks[6].y;
    const isMiddleClosed = landmarks[12].y > landmarks[10].y;
    const isRingClosed = landmarks[16].y > landmarks[14].y;
    const isPinkyClosed = landmarks[20].y > landmarks[18].y;
    
    // Count how many fingers are closed
    const closedCount = (isIndexClosed ? 1 : 0) + (isMiddleClosed ? 1 : 0) + (isRingClosed ? 1 : 0) + (isPinkyClosed ? 1 : 0);

    // 1. Gesture: THUMB_UP (Like) - Thumb points up, others closed
    const distTipKnuckle = getDistance(landmarks[4], landmarks[5]);
    const distTipBase = getDistance(landmarks[4], landmarks[2]);
    const isThumbExtended = distTipKnuckle > 0.08 && distTipBase > 0.06;
    const isThumbPointingUp = landmarks[4].y < landmarks[2].y && landmarks[4].y < landmarks[5].y;
    const isThumbUp = isThumbExtended && isThumbPointingUp;
    
    if (isThumbUp && isIndexClosed && isMiddleClosed && isRingClosed && isPinkyClosed) {
      return 'THUMB_UP';
    }

    // 3. Gesture: PEACE (Victory) - Index and Middle open, others closed
    if (!isIndexClosed && !isMiddleClosed && isRingClosed && isPinkyClosed) {
      return 'PEACE';
    }

    // 5. Gesture: OK - Thumb and Index touch, others open
    const distThumbIndex = getDistance(landmarks[4], landmarks[8]);
    if (distThumbIndex < 0.045 && !isMiddleClosed && !isRingClosed && !isPinkyClosed) {
      return 'OK';
    }
    
    // 6. Gesture: INDEX_POINTING (Chỉ ngón trỏ) - Index open, others closed
    if (!isIndexClosed && isMiddleClosed && isRingClosed && isPinkyClosed) {
      return 'INDEX_POINTING';
    }

    // 7. Gesture: FIST (Nắm tay) - 3 or more fingers closed (evaluated after others)
    if (closedCount >= 3) {
      return 'FIST';
    }

    // 8. Default: OPEN_PALM (Mở rộng tay)
    return 'OPEN_PALM';
  }

  // MediaPipe hands callback trigger
  function onResults(results) {
    try {
      // Hide loading screen on first successful frame analysis
      if (loadingOverlay) {
        loadingOverlay.classList.add('fade-out');
      }

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // We only track 1 hand
        const landmarks = results.multiHandLandmarks[0];
        
        // 1. Update HUD status to Found
        if (scanStatus && statusText) {
          scanStatus.classList.remove('lost');
          scanStatus.classList.add('found');
          statusText.textContent = 'Đã nhận diện tay';
          if (eyeOffIcon && eyeOnIcon) {
            eyeOffIcon.classList.add('hidden');
            eyeOnIcon.classList.remove('hidden');
          }
        }

        // 2. Render joint spheres & skeleton lines
        const linePosAttr = skeletonLines ? skeletonLines.geometry.attributes.position : null;
        landmarks.forEach((lm, idx) => {
          const threePos = mapCoordinates(lm.x, lm.y, lm.z);
          jointSpheres[idx].position.set(threePos.x, threePos.y, threePos.z);
          jointSpheres[idx].visible = true;

          if (linePosAttr) {
            linePosAttr.array[idx * 3] = threePos.x;
            linePosAttr.array[idx * 3 + 1] = threePos.y;
            linePosAttr.array[idx * 3 + 2] = threePos.z;
          }
        });
        
        if (linePosAttr) {
          linePosAttr.needsUpdate = true;
        }
        if (skeletonLines) {
          skeletonLines.visible = true;
        }

        // 3. Analyze finger gesture
        const gesture = analyzeHandGesture(landmarks);
        
        if (gesture === 'FIST') {
          isHandOpen = false; // Hide CV
        } else if (gesture === 'OPEN_PALM') {
          isHandOpen = true; // Show CV
          arGroup.visible = true;
        } else if (gesture === 'INDEX_POINTING') {
          isHandOpen = true;
          arGroup.visible = true;
          if (arGroup) {
            arGroup.rotation.y += 0.08; // Spin faster!
          }
        } else {
          // Handle action triggers (OK, PEACE, THUMB_UP, ROCK_ON, L_SIGN)
          isHandOpen = true;
          arGroup.visible = true;
          triggerGestureAction(gesture);
        }

        // 4. Update CV center point (float above palm center)
        const palmX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4;
        const palmY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4;
        const palmZ = (landmarks[0].z + landmarks[5].z + landmarks[9].z + landmarks[17].z) / 4;
        
        const palmThreePos = mapCoordinates(palmX, palmY, palmZ);
        
        // Floating offset
        targetPos.x = palmThreePos.x;
        targetPos.y = palmThreePos.y + 4; 
        targetPos.z = palmThreePos.z + 5; 
        
      } else {
        // No hand detected
        jointSpheres.forEach(sphere => {
          sphere.visible = false;
        });
        if (skeletonLines) {
          skeletonLines.visible = false;
        }

        isHandOpen = false;

        if (scanStatus && statusText) {
          scanStatus.classList.remove('found');
          scanStatus.classList.add('lost');
          statusText.textContent = 'Không tìm thấy tay';
          if (eyeOffIcon && eyeOnIcon) {
            eyeOnIcon.classList.add('hidden');
            eyeOffIcon.classList.remove('hidden');
          }
        }
      }
    } catch (err) {
      console.error("Error in onResults tracking loop: ", err);
    }
  }

  // Initialize MediaPipe Hands
  const hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  hands.onResults(onResults);

  // Setup Webcam using MediaPipe Camera utils
  if (webcamVideo) {
    const cameraUtils = new Camera(webcamVideo, {
      onFrame: async () => {
        await hands.send({ image: webcamVideo });
      },
      width: 640,
      height: 480
    });
    cameraUtils.start();
  }

  // Force reload when navigating back via browser history (fixes frozen BFCache camera)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      window.location.reload();
    }
  });
});
