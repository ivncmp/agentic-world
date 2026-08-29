/**
 * Hover tint for whatever the cursor is over.
 *
 * GLB clones share their materials, so a tinted variant is built once per
 * source material and reused — tinting per instance would multiply the
 * material count by the number of buildings in the city.
 */
import * as THREE from 'three'

const TINT = new THREE.Color(0xffffff)
const GLOW = new THREE.Color(0x4fa8ff)

export class Highlighter {
  private readonly cache = new Map<THREE.Material, THREE.Material>()
  private restore: { mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[] }[] = []
  private root: THREE.Object3D | null = null

  /** Tint `root` and clear the previous one. Passing null clears everything. */
  set(root: THREE.Object3D | null): void {
    if (this.root === root) return
    for (const e of this.restore) e.mesh.material = e.mat
    this.restore = []
    this.root = root
    if (root == null) return

    root.traverse((c) => {
      const mesh = c as THREE.Mesh
      if (!mesh.isMesh || mesh.material == null) return
      this.restore.push({ mesh, mat: mesh.material })
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(m => this.variant(m))
        : this.variant(mesh.material)
    })
  }

  private variant(m: THREE.Material): THREE.Material {
    let h = this.cache.get(m)
    if (!h) {
      h = m.clone()
      const std = h as THREE.MeshStandardMaterial
      if (std.color) std.color = std.color.clone().lerp(TINT, 0.35)
      if (std.emissive) {
        std.emissive = GLOW.clone()
        std.emissiveIntensity = 0.55
      }
      this.cache.set(m, h)
    }
    return h
  }
}

/** Walk up to the nearest ancestor that carries pick metadata. */
export function pickRoot(obj: THREE.Object3D): THREE.Object3D | null {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    if (cur.userData.pick != null) return cur
    cur = cur.parent
  }
  return null
}
