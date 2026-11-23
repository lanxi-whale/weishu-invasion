// Official client sprites for the pregame shell. All URLs come from the installed local manifest.
import { data } from '../data.js';
import { officialAssetUrl } from '../../../shared/uiTheme.js';

const SPRITES = Object.freeze({
  backdrop: ['ui/outer', 'img_bkg_main'],
  scan: ['ui/outer', 'img_screen_line_repeat'],
  heading: ['ui/outer', 'img_group_title'],
  core: ['ui/outer', 'img_group_title_icon_temp_bond'],
  addon: ['ui/outer', 'img_group_title_icon_perm_bond'],
  chess: ['ui/outer', 'img_title_icon_chess'],
  bondOn: ['ui/outer', 'img_bond_bkg'],
  bondOff: ['ui/outer', 'img_bond_item_bkg'],
  group: ['ui/outer', 'img_bond_group_select'],
  confirm: ['ui/outer', 'btn_confirm'],
  confirmed: ['ui/outer', 'btn_confirmed'],
  dialog: ['ui/common', 'popup_frame'],
  primary: ['ui/common', 'img_confirm_dialog_btn_green_bg'],
  secondary: ['ui/common', 'img_confirm_dialog_btn_gray_bg'],
  danger: ['ui/common', 'img_confirm_dialog_btn_red_bg'],
  match: ['ui/outer', 'btn_match_normal'],
  'home-match': ['ui/outer', 'btn_match_normal'],
  matchOff: ['ui/outer', 'btn_match_grey'],
  radar: ['ui/outer', 'img_left_bkg'],
  speech: ['ui/outer', 'img_chat_babble'],
  'room-exit': ['ui/outer', 'img_return'],
  'room-code': ['ui/outer', 'bg_room_id'],
  'room-copy': ['ui/outer', 'btn_bg_duplicate'],
  'room-modes': ['ui/outer', 'bg_mode'],
  'room-empty': ['ui/outer', 'bg_empty'],
  'room-plate': ['ui/outer', 'card_empty'],
  'room-plus': ['ui/outer', 'bg_plus'],
  'room-noinfo': ['ui/outer', 'noinfo'],
  'room-strip': ['ui/outer', 'bg_top_normal'],
  'room-strip-ready': ['ui/outer', 'bg_top_ready'],
  'room-matte': ['ui/outer', 'front_matte_normal'],
  'room-prepared': ['ui/outer', 'icon_prepared'],
  'room-cancel': ['ui/outer', 'btn_match_cancel'],
  'room-host': ['ui/outer', 'btn_match_host_normal'],
  'ally-radar-frame': ['ui/outer', 'bg_desc_left'],
  'ally-radar-grid': ['ui/outer', 'img_desc_grid'],
  'ally-radar-ring': ['ui/outer', 'img_center_circle'],
  'ally-radar-pointer': ['ui/outer', 'img_pointer'],
  'ally-radar-cross': ['ui/outer', 'img_center_cross'],
  'ally-radar-sweep': ['ui/outer', 'img_scan_circle_mask'],
  'ally-panel': ['ui/outer', 'room_select_right_bg'],
  'ally-title': ['ui/outer', 'room_select_icon'],
  'ally-create-frame': ['ui/outer', 'room_create_btn_bg'],
  'ally-create-bar': ['ui/outer', 'room_select_create_btn_bg_down'],
  'ally-create-art': ['ui/outer', 'room_select_create_middleicon'],
  'ally-create-logo': ['ui/outer', 'room_select_create_logo'],
  'ally-create-icon': ['ui/outer', 'create_icon'],
  'ally-join-frame': ['ui/outer', 'room_join_btn_bg'],
  'ally-join-bar': ['ui/outer', 'room_select_join_btn_bg_down'],
  'ally-join-art': ['ui/outer', 'room_select_join_middle_block'],
  'ally-join-left': ['ui/outer', 'room_select_join_left_block'],
  'ally-join-right': ['ui/outer', 'room_select_join_right_block'],
  'ally-join-logo': ['ui/outer', 'room_select_join_logo'],
  'ally-join-icon': ['ui/outer', 'join_icon'],
  'ally-key': ['ui/outer', 'room_select_join_text_bg'],
});

export function officialUiProperties(manifest, baseManifest = manifest) {
  const style = {};
  for (const [key, [group, name]] of Object.entries(SPRITES)) {
    const groups = (key === 'home-match' ? baseManifest : manifest)?.groups;
    const entry = groups?.[group]?.[name];
    const variant = groups?.['ui/invasion']?.[`${group}/${name}`];
    const assetGroup = variant && variant === entry ? 'ui/invasion' : group;
    const url = officialAssetUrl(assetGroup, entry);
    if (url && !/["'\\()\s\u0000-\u001f]/.test(url)) style[`--official-${key}`] = `url("${url}")`;
  }
  return style;
}

/** Refresh when the data store changes; the content set and locale can arrive after boot. */
export function installOfficialUi(root = globalThis.document?.documentElement, source = data) {
  if (!root) return () => {};
  let previous = [];
  const update = () => {
    for (const key of previous) root.style.removeProperty(key);
    const style = officialUiProperties(source.get('local'), source.getRaw('local'));
    previous = Object.keys(style);
    for (const [key, value] of Object.entries(style)) root.style.setProperty(key, value);
    root.toggleAttribute('data-official-ui', !!style['--official-heading']);
  };
  const unsubscribe = source.subscribe(update);
  update();
  source.load('local').catch(() => {});
  return () => {
    unsubscribe();
    for (const key of previous) root.style.removeProperty(key);
    root.removeAttribute('data-official-ui');
  };
}
