"""New littlechef environment names, with legacy deployment compatibility."""
import os


def apply_legacy_aliases():
    for key, value in tuple(os.environ.items()):
        if key.startswith('KITCHEN_'):
            os.environ.setdefault('LITTLE_CHEF_' + key[len('KITCHEN_'):], value)


apply_legacy_aliases()
