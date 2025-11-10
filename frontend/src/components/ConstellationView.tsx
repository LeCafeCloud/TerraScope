import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Graph, Node } from '../types/api';

interface ConstellationViewProps {
    graph: Graph;
    filters: {
        provider: string;
        module: string;
        mode: string;
    };
    selectedNodeId: string | null;
    onNodeClick: (nodeId: string) => void;
}

const PROVIDER_COLORS: Record<string, number> = {
    aws: 0xff9900,
    azurerm: 0x0078d4,
    google: 0x4285f4,
    kubernetes: 0x326ce5,
    helm: 0x0f1689,
    default: 0x8b5cf6,
};

export default function ConstellationView({
    graph,
    filters,
    selectedNodeId,
    onNodeClick,
}: ConstellationViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const nodeObjectsRef = useRef<Map<string, THREE.Mesh>>(new Map());
    const edgeObjectsRef = useRef<THREE.Line[]>([]);

    useEffect(() => {
        if (!containerRef.current) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(
            75,
            containerRef.current.clientWidth / containerRef.current.clientHeight,
            0.1,
            10000
        );
        camera.position.set(0, 0, 500);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(
            containerRef.current.clientWidth,
            containerRef.current.clientHeight
        );
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controlsRef.current = controls;

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); // Increased intensity
        scene.add(ambientLight);

        const pointLight1 = new THREE.PointLight(0xffffff, 1.5);
        pointLight1.position.set(200, 200, 200);
        scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0x8b5cf6, 1);
        pointLight2.position.set(-200, -200, 200);
        scene.add(pointLight2);

        const pointLight3 = new THREE.PointLight(0xffffff, 0.8);
        pointLight3.position.set(0, -200, -200);
        scene.add(pointLight3);

        addStarField(scene);

        const handleResize = () => {
            if (!containerRef.current || !camera || !renderer) return;
            camera.aspect =
                containerRef.current.clientWidth / containerRef.current.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(
                containerRef.current.clientWidth,
                containerRef.current.clientHeight
            );
        };
        window.addEventListener('resize', handleResize);

        const animate = () => {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        return () => {
            window.removeEventListener('resize', handleResize);
            renderer.dispose();
            containerRef.current?.removeChild(renderer.domElement);
        };
    }, []);

    useEffect(() => {
        if (!sceneRef.current) return;

        const scene = sceneRef.current;
        const nodeObjects = nodeObjectsRef.current;

        nodeObjects.forEach((obj) => scene.remove(obj));
        nodeObjects.clear();
        edgeObjectsRef.current.forEach((line) => scene.remove(line));
        edgeObjectsRef.current = [];

        const filteredNodes = graph.nodes.filter((node) => {
            if (filters.provider && node.provider !== filters.provider) return false;
            if (filters.module && node.module !== filters.module) return false;
            if (filters.mode && node.mode !== filters.mode) return false;
            return true;
        });

        filteredNodes.forEach((node, index) => {
            const nodeObj = createNodeObject(node, index, filteredNodes.length);
            scene.add(nodeObj);
            nodeObjects.set(node.id, nodeObj);
        });

        const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
        graph.edges.forEach((edge) => {
            if (filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)) {
                const sourceObj = nodeObjects.get(edge.source);
                const targetObj = nodeObjects.get(edge.target);
                if (sourceObj && targetObj) {
                    const line = createEdgeObject(sourceObj, targetObj, edge.type);

                    line.userData = {
                        sourceId: edge.source,
                        targetId: edge.target,
                        edgeType: edge.type,
                    };

                    scene.add(line);
                    edgeObjectsRef.current.push(line);
                }
            }
        });

        edgeObjectsRef.current.forEach((line) => {
            const edgeType = line.userData.edgeType;
            const defaultColor = edgeType === 'depends_on' ? 0x8b5cf6 : 0x6b7280;
            (line.material as THREE.LineBasicMaterial).color.setHex(defaultColor);
            (line.material as THREE.LineBasicMaterial).opacity = 0.6;
        });
    }, [graph, filters]);

    useEffect(() => {
        const nodeObjects = nodeObjectsRef.current;

        nodeObjects.forEach((obj, nodeId) => {
            const material = obj.material as THREE.MeshStandardMaterial;
            if (nodeId === selectedNodeId) {
                material.emissive.setHex(0xffffff);
                material.emissiveIntensity = 0.5;
            } else {
                const originalColor = (obj.material as THREE.MeshStandardMaterial).color.getHex();
                material.emissive.setHex(originalColor);
                material.emissiveIntensity = 0.5;
            }
        });
    }, [selectedNodeId]);

    useEffect(() => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!renderer || !camera || !controls) return;

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        let isDragging = false;

        controls.addEventListener('start', () => {
            isDragging = true;
        });

        controls.addEventListener('end', () => {
            setTimeout(() => {
                isDragging = false;
            }, 0);
        });

        const handlePointerUp = (event: PointerEvent) => {
            if (!containerRef.current || isDragging) return;

            const rect = containerRef.current.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            const objects = Array.from(nodeObjectsRef.current.values());
            const intersects = raycaster.intersectObjects(objects);

            if (intersects.length > 0) {
                const clicked = intersects[0].object as THREE.Mesh;
                const nodeId = Array.from(nodeObjectsRef.current.entries()).find(
                    ([_, obj]) => obj === clicked
                )?.[0];

                if (nodeId) {
                    onNodeClick(nodeId);
                }
            }
        };

        renderer.domElement.addEventListener('pointerup', handlePointerUp);

        return () => {
            controls.removeEventListener('start', () => (isDragging = true));
            controls.removeEventListener('end', () => (isDragging = false));
            renderer.domElement.removeEventListener('pointerup', handlePointerUp);
        };
    }, [onNodeClick]);

    return (
        <div ref={containerRef} className="w-full h-full" />
    );
}

function createNodeObject(
    node: Node,
    index: number,
    total: number
): THREE.Mesh {
    const phi = Math.acos(-1 + (2 * index) / total);
    const theta = Math.sqrt(total * Math.PI) * phi;
    const radius = 300;

    const x = radius * Math.cos(theta) * Math.sin(phi);
    const y = radius * Math.sin(theta) * Math.sin(phi);
    const z = radius * Math.cos(phi);
    const size = node.mode === 'managed' ? 12 : 8;
    const color =
        PROVIDER_COLORS[node.provider.toLowerCase()] || PROVIDER_COLORS.default;

    const geometry = new THREE.SphereGeometry(size, 32, 32);
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        metalness: 0.3,
        roughness: 0.3,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.userData = { nodeId: node.id };

    const glowGeometry = new THREE.SphereGeometry(size * 1.3, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.2,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    mesh.add(glow);

    return mesh;
}

function createEdgeObject(
    source: THREE.Mesh,
    target: THREE.Mesh,
    edgeType: string
): THREE.Line {
    const points = [source.position, target.position];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const color = edgeType === 'depends_on' ? 0x8b5cf6 : 0x6b7280;
    const material = new THREE.LineBasicMaterial({
        color,
        opacity: 0.6,
        transparent: true,
        linewidth: 2,
    });

    return new THREE.Line(geometry, material);
}

function addStarField(scene: THREE.Scene) {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 2000;
        positions[i + 1] = (Math.random() - 0.5) * 2000;
        positions[i + 2] = (Math.random() - 0.5) * 2000;
    }

    starGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3)
    );

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);

    const starMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2,
        transparent: true,
        opacity: 0.6,
        map: texture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
}
