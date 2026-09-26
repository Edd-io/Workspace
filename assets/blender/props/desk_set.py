"""Everything found on and around a workstation."""

import math
import random

from lib.kit import box, cylinder, ico, join, rod, sphere, torus

DESK_HEIGHT = 0.74


def desk():
    parts = [box((1.5, 0.75, 0.035), (0, 0, DESK_HEIGHT - 0.0175), "wood_light", bevel=0.006, segments=3)]
    for x in (-0.68, 0.68):
        for y in (-0.3, 0.3):
            parts.append(box((0.05, 0.05, 0.705), (x, y, 0.3525), "metal_dark", bevel=0.004))
        parts.append(box((0.06, 0.7, 0.03), (x, 0, 0.015), "metal_dark", bevel=0.006))
        parts.append(box((0.04, 0.66, 0.04), (x, 0, 0.68), "metal_dark", bevel=0.004))
    parts.append(box((1.3, 0.03, 0.09), (0, 0.3, 0.63), "metal_dark", bevel=0.004))
    # Drawer pedestal on the right, drawers facing the person sitting at the desk (front, -Y).
    parts.append(box((0.4, 0.5, 0.52), (0.44, -0.04, 0.28), "wood_mid", bevel=0.006))
    for z in (0.12, 0.29, 0.46):
        parts.append(box((0.37, 0.012, 0.15), (0.44, -0.295, z), "wood_light", bevel=0.003))
        parts.append(box((0.12, 0.02, 0.015), (0.44, -0.305, z + 0.04), "metal_light", bevel=0.003))
    parts.append(cylinder(0.03, 0.004, (0.55, 0.28, DESK_HEIGHT + 0.001), "plastic_black", vertices=16))
    return join(parts, "desk")


def office_chair():
    parts = []
    for i in range(5):
        angle = math.radians(i * 72 + 90)
        parts.append(box((0.3, 0.05, 0.035), (0.14 * math.cos(angle), 0.14 * math.sin(angle), 0.085),
                         "plastic_black", bevel=0.008, rotation=(0, 0, math.degrees(angle))))
        parts.append(sphere(0.028, (0.28 * math.cos(angle), 0.28 * math.sin(angle), 0.03), "rubber", segments=10,
                            rings=6))
    parts.append(cylinder(0.05, 0.06, (0, 0, 0.09), "plastic_black", vertices=16))
    parts.append(cylinder(0.024, 0.28, (0, 0, 0.26), "chrome", vertices=12))
    parts.append(box((0.22, 0.22, 0.04), (0, 0, 0.405), "plastic_black", bevel=0.006))
    parts.append(box((0.5, 0.48, 0.08), (0, 0, 0.465), "fabric_dark", bevel=0.03, segments=3))
    parts.append(box((0.07, 0.04, 0.34), (0, 0.24, 0.56), "plastic_black", bevel=0.01))
    parts.append(box((0.46, 0.07, 0.56), (0, 0.27, 0.86), "fabric_dark", bevel=0.03, segments=3,
                     rotation=(-8, 0, 0)))
    for x in (-0.27, 0.27):
        parts.append(box((0.035, 0.04, 0.2), (x, 0.03, 0.56), "plastic_black", bevel=0.006))
        parts.append(box((0.06, 0.25, 0.03), (x, 0.0, 0.665), "plastic_black", bevel=0.01))
    return join(parts, "office_chair")


def monitor():
    parts = [
        box((0.24, 0.17, 0.012), (0, 0.01, 0.006), "metal_dark", bevel=0.004),
        box((0.05, 0.03, 0.24), (0, 0.035, 0.13), "metal_dark", bevel=0.006),
        box((0.64, 0.028, 0.385), (0, 0.0, 0.335), "plastic_black", bevel=0.005),
        # Screen surface; the web client overlays the live terminal preview on it.
        box((0.605, 0.004, 0.345), (0, -0.0145, 0.338), "screen_black", bevel=0.0),
    ]
    return join(parts, "monitor")


def keyboard():
    parts = [box((0.44, 0.145, 0.016), (0, 0, 0.008), "plastic_white", bevel=0.004)]
    key = 0.0245
    for row in range(5):
        count = 16 if row < 4 else 9
        width = key if row < 4 else key * 1.3
        for col in range(count):
            x = -0.205 + col * (key + 0.002) + width / 2
            if row == 4:
                x = -0.205 + col * (width + 0.002) + width / 2
                if col == 4:
                    continue  # Space bar drawn below.
            parts.append(box((width - 0.003, key - 0.004, 0.006), (x, -0.052 + row * key, 0.019), "plastic_gray",
                             bevel=0.0))
    parts.append(box((0.12, key - 0.004, 0.006), (0, -0.052 + 4 * key, 0.019), "plastic_gray", bevel=0.0))
    return join(parts, "keyboard")


def mouse():
    return join([sphere(0.03, (0, 0, 0.012), "plastic_black", segments=14, rings=8, scale=(0.95, 1.7, 0.6))],
                "mouse")


def mug(name="mug", color="ceramic_white"):
    parts = [
        cylinder(0.04, 0.095, (0, 0, 0.0475), color, vertices=20),
        cylinder(0.035, 0.002, (0, 0, 0.085), "coffee", vertices=20),
        torus(0.025, 0.007, (0.045, 0, 0.05), color, rotation=(90, 0, 0)),
    ]
    return join(parts, name)


def mug_blue():
    return mug("mug_blue", "ceramic_blue")


def mug_yellow():
    return mug("mug_yellow", "ceramic_yellow")


def desk_lamp():
    elbow = (0, 0.06, 0.4)
    head = (0, -0.16, 0.45)
    parts = [
        cylinder(0.075, 0.02, (0, 0, 0.01), "metal_dark", vertices=24),
        sphere(0.018, (0, 0, 0.03), "metal_dark", segments=10, rings=6),
        rod((0, 0, 0.03), elbow, 0.011),
        sphere(0.016, elbow, "metal_dark", segments=10, rings=6),
        rod(elbow, head, 0.009),
        # Shade: a cone pointing down toward the desk.
        cylinder(0.025, 0.09, (head[0], head[1], head[2] - 0.035), "metal_dark", vertices=20, radius_top=0.07,
                 rotation=(180, 0, 0)),
        sphere(0.026, (head[0], head[1], head[2] - 0.075), "light_warm", segments=12, rings=8),
    ]
    return join(parts, "desk_lamp")


def plant_small():
    rng = random.Random(7)
    parts = [
        cylinder(0.06, 0.09, (0, 0, 0.045), "terracotta", vertices=16, radius_top=0.07),
        cylinder(0.062, 0.004, (0, 0, 0.085), "soil", vertices=16),
    ]
    for i in range(7):
        angle = i / 7 * math.tau
        parts.append(ico(0.035, (0.03 * math.cos(angle), 0.03 * math.sin(angle), 0.11 + rng.random() * 0.03),
                         "leaf_light" if i % 2 else "leaf_green", subdivisions=1, scale=(0.6, 0.6, 1.4),
                         rotation=(math.degrees(0.4 * math.sin(angle)), math.degrees(0.4 * math.cos(angle)), 0)))
    return join(parts, "plant_small")


def notebook():
    parts = [
        box((0.15, 0.21, 0.012), (0, 0, 0.006), "book_1", bevel=0.002),
        box((0.14, 0.2, 0.01), (0.004, 0, 0.006), "paper", bevel=0.0),
        box((0.004, 0.2, 0.014), (-0.074, 0, 0.007), "metal_dark", bevel=0.0),
    ]
    return join(parts, "notebook")


def pen_holder():
    parts = [cylinder(0.035, 0.1, (0, 0, 0.05), "metal_dark", vertices=16)]
    for i, color in enumerate(("blue", "red", "plastic_black", "yellow")):
        angle = i / 4 * math.tau
        parts.append(cylinder(0.005, 0.15, (0.015 * math.cos(angle), 0.015 * math.sin(angle), 0.1), color,
                              vertices=6, rotation=(8 * math.sin(angle), 8 * math.cos(angle), 0)))
    return join(parts, "pen_holder")


def headphones():
    parts = [
        torus(0.085, 0.009, (0, 0, 0.1), "plastic_black", rotation=(90, 0, 0)),
        cylinder(0.04, 0.035, (-0.085, 0, 0.04), "plastic_black", vertices=16, rotation=(0, 90, 0)),
        cylinder(0.04, 0.035, (0.085, 0, 0.04), "plastic_black", vertices=16, rotation=(0, 90, 0)),
    ]
    return join(parts, "headphones")


def water_bottle():
    parts = [
        cylinder(0.035, 0.2, (0, 0, 0.1), "metal_light", vertices=16),
        cylinder(0.025, 0.03, (0, 0, 0.215), "plastic_black", vertices=16),
    ]
    return join(parts, "water_bottle")


def paper_stack():
    rng = random.Random(3)
    parts = []
    for i in range(6):
        parts.append(box((0.21, 0.297, 0.004), (rng.uniform(-0.01, 0.01), rng.uniform(-0.01, 0.01), 0.002 + i * 0.004),
                         "paper", bevel=0.0, rotation=(0, 0, rng.uniform(-6, 6))))
    return join(parts, "paper_stack")


def sticky_notes():
    parts = [box((0.076, 0.076, 0.02), (0, 0, 0.01), "yellow", bevel=0.001)]
    return join(parts, "sticky_notes")


def laptop():
    parts = [
        box((0.32, 0.22, 0.012), (0, 0, 0.006), "metal_light", bevel=0.004),
        box((0.28, 0.1, 0.002), (0, -0.02, 0.013), "plastic_gray", bevel=0.0),
        box((0.32, 0.012, 0.21), (0, 0.105, 0.11), "metal_light", bevel=0.004, rotation=(-15, 0, 0)),
        box((0.29, 0.002, 0.18), (0, 0.097, 0.112), "screen_black", bevel=0.0, rotation=(-15, 0, 0)),
    ]
    return join(parts, "laptop")


PROPS = {
    "desk": desk,
    "office_chair": office_chair,
    "monitor": monitor,
    "keyboard": keyboard,
    "mouse": mouse,
    "mug": mug,
    "mug_blue": mug_blue,
    "mug_yellow": mug_yellow,
    "desk_lamp": desk_lamp,
    "plant_small": plant_small,
    "notebook": notebook,
    "pen_holder": pen_holder,
    "headphones": headphones,
    "water_bottle": water_bottle,
    "paper_stack": paper_stack,
    "sticky_notes": sticky_notes,
    "laptop": laptop,
}
