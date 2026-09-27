"""Validate persisted shapes before a malformed record can break every client."""
import math
import re
from datetime import date


def text(value, label):
    if not isinstance(value, str): raise ValueError(label + ' 必须是文字')


def number(value, label, minimum=0, maximum=100000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(label + ' 必须是有效范围内的数字')


def strings(value, label):
    if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
        raise ValueError(label + ' 必须是文字列表')


def day(value, label):
    if value is None: return
    text(value, label)
    if value:
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value): raise ValueError()
            date.fromisoformat(value)
        except ValueError: raise ValueError(label + ' 必须是有效日期 YYYY-MM-DD') from None


def log(entry):
    if not isinstance(entry, dict): raise ValueError('记录必须是对象')
    for key in ('note', 'cook'):
        if key in entry: text(entry[key], key)
    if 'date' in entry: day(entry['date'], 'date')
    if entry.get('rating') is not None: number(entry['rating'], 'rating', 1, 5)
    if 'changed' in entry: strings(entry['changed'], 'changed')


def item(collection, value):
    if collection not in ('recipes', 'pantry', 'menus') or not isinstance(value, dict):
        raise ValueError('数据必须是有效集合中的对象')
    if value.get('id') is not None:
        ident = value['id']
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,80}', ident) or '..' in ident:
            raise ValueError('id 不合法')
    for key in ('title', 'name', 'subtitle', 'latin', 'slug', 'summary', 'notes', 'source', 'brand', 'where',
                'taste', 'pick', 'store', 'substitutes', 'plating', 'image_prompt', 'template', 'template_name'):
        if key == 'notes' and collection == 'menus': continue
        if key in value and value[key] is not None: text(value[key], key)
    for key in ('image', 'original_image', 'illustration_image'):
        filename = value.get(key)
        if filename is not None:
            text(filename, key)
            if filename and (filename.startswith('.') or '/' in filename or '\\' in filename or '\x00' in filename):
                raise ValueError(key + ' 必须是图片文件名')
    for key in ('favorite', 'make_ahead', 'hands_off', 'in_stock'):
        if key in value and not isinstance(value[key], bool): raise ValueError(key + ' 必须是布尔值')
    for key in ('servings', 'guests'):
        if key in value: number(value[key], key, 1, 10000)
    if 'difficulty' in value: number(value['difficulty'], 'difficulty', 1, 5)
    for key in ('date', 'last_cooked', 'stock_checked'):
        if key in value: day(value[key], key)
    for key in ('course_role', 'pairs_with'):
        if key in value: strings(value[key], key)
    if collection == 'pantry':
        for key in ('tags', 'season'):
            if key in value: strings(value[key], key)
        if 'kind' in value and value['kind'] not in ('ingredient', 'seasoning'): raise ValueError('食材类别不合法')
    if collection == 'recipes':
        tags = value.get('tags', {})
        if not isinstance(tags, dict): raise ValueError('tags 必须是对象')
        for key, values in tags.items():
            if key in ('__proto__', 'constructor', 'prototype'): raise ValueError('标签维度不合法')
            strings(values, 'tags.' + key)
        if 'time' in value:
            if not isinstance(value['time'], dict): raise ValueError('time 必须是对象')
            for key, val in value['time'].items(): number(val, 'time.' + key)
    for key in ('ingredients', 'seasonings', 'steps', 'log', 'dishes'):
        if key not in value: continue
        if not isinstance(value[key], list) or any(not isinstance(v, dict) for v in value[key]):
            raise ValueError(key + ' 必须是对象列表')
        for row in value[key]:
            if key == 'log': log(row)
            else:
                for field in ('name', 'qty', 'note', 'text', 'tip', 'id', 'role', 'title'):
                    if field in row: text(row[field], field)
                if row.get('pantry') is not None: text(row['pantry'], 'pantry')
    if collection == 'menus' and 'notes' in value: strings(value['notes'], 'notes')


def taxonomy(value):
    if not isinstance(value, dict): raise ValueError('taxonomy 必须是对象')
    for key in ('facets', 'course_roles', 'menu_templates', 'derived_facets'):
        if key in value and (not isinstance(value[key], list) or any(not isinstance(x, dict) for x in value[key])):
            raise ValueError(key + ' 必须是对象列表')
    for facet in value.get('facets', []):
        text(facet.get('key'), 'facet.key')
        vals = facet.get('values', [])
        if not isinstance(vals, list) or any(not isinstance(v, dict) or not isinstance(v.get('name'), str) for v in vals):
            raise ValueError('facet.values 必须包含名称')
    for role in value.get('course_roles', []):
        text(role.get('name'), 'role.name')
    for template in value.get('menu_templates', []):
        text(template.get('key'), 'template.key')
        if not isinstance(template.get('slots', []), list): raise ValueError('template.slots 必须是列表')
        for slot in template.get('slots', []):
            if not isinstance(slot, dict): raise ValueError('slot 必须是对象')
            text(slot.get('role'), 'slot.role')
