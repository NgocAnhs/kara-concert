alter table public.lyric_lines
  add column viet_han text;

update public.lyric_lines as line
set viet_han = pronunciations.viet_han
from (
  values
    (0, 'Lu zờ, uê-tô-ri, sen chờ-kha-nưn kơp-cheng-i'),
    (1, 'Mốt-tuên yang-a-chi, cơ-ul xô-gê nơn'),
    (2, 'Chớt-tờ lu zờ, uê-tô-ri, sang-chơ-pu-nin mơ-chơ-ri'),
    (3, 'Tơ-rô-un sư-rơ-ghi, cơ-ul xô-gê nan, ai-mờ'),
    (4, 'Xôn-chi-khi sê-sang-gwa nan ơ-ul-lin chọc óp-sơ'),
    (5, 'Hô-lô-yót-tơn ne-gên sa-rang tta-win bờl-sơ'),
    (6, 'It-hi-ơ-chin chi ô-rê chơ xi-gan xô-gê'),
    (7, 'Tơ i-sang-ưn mốt tứt-kẹ-sơ hu-i-mang-chan sa-rang nô-rê'),
    (8, 'Nơ-na na-na cư-chơ gil-tư-ri-ơ-chin tê-rô'),
    (9, 'Gạc-bon xô-gê nô-ra-na-nưn xưl-pưn ppi-ê-rô'),
    (10, 'Nan mơl-li oa-bơ-ri-ót-sơ, ai-m câm-ming hôm'),
    (11, 'I-chê ta-xi tô-ra-gal-lê, ơ-ril chọc chê-cha-ri-rô'),
    (12, 'Ơn-chê-bu-tơn-ga nan, yê'),
    (13, 'Ha-nưl bô-da ttang-ưl tơ ba-ra-bô-gê tuê'),
    (14, 'Xum-xui-gi-chô-cha him-gyơ-uô'),
    (15, 'Xô-nưl ppơt-chi-man'),
    (16, 'Cư nu-gu-đô nal cha-ba-chu-chil an-nê, ai-mờ'),
    (17, 'Lu zờ, uê-tô-ri, sen chờ-kha-nưn kơp-cheng-i'),
    (18, 'Mốt-tuên yang-a-chi, cơ-ul xô-gê nơn'),
    (19, 'Chớt-tờ lu zờ, uê-tô-ri, sang-chơ-pu-nin mơ-chơ-ri'),
    (20, 'Tơ-rô-un sư-rơ-ghi, cơ-ul xô-gê nan, ai-mờ'),
    (21, 'Ban-bốc-tuê-nưn yơ-cha-tưl-gwa-ui ne xil-xu'),
    (22, 'Ha-rút-ba-mưl sa-rang-ha-gô hê ttư-myơn xil-chưng'),
    (23, 'Chéc-im-chi-chi mốt-hal na-ui i-gi-chơ-gin gi-ppưm'),
    (24, 'Ha-na ttê-mê mô-tưn gơ-xi mang-ga-chơ-bơ-rin chi-gưm'),
    (25, 'Mơm-chul chul mô-rư-tơn na-ui ui-hơm-han chil-chu'),
    (26, 'I-chen a-mu-rơn gam-hưng-đô che-mi-đô óp-nưn gi-bun'),
    (27, 'Na byơ-rang kkư-tê hon-cha in-nê, ai-m gô-ing hôm'),
    (28, 'Na ta-xi tô-ra-gal-lê yê-chơ-nưi chê-cha-ri-rô'),
    (29, 'Ơn-chê-bu-tơn-ga nan, yê'),
    (30, 'Xa-ram-tư-rưi xi-xơ-nưl tu-ryơ-uô-man hê'),
    (31, 'U-nưn gọt-chô-cha chi-gyơ-uô'),
    (32, 'U-xơ-bô-chi-man'),
    (33, 'Cư a-mu-đô nal a-ra-chu-chil an-nê, ai-mờ'),
    (34, 'Lu zờ, uê-tô-ri, sen chờ-kha-nưn kơp-cheng-i'),
    (35, 'Mốt-tuên yang-a-chi, cơ-ul xô-gê nơn'),
    (36, 'Chớt-tờ lu zờ, uê-tô-ri, sang-chơ-pu-nin mơ-chơ-ri'),
    (37, 'Tơ-rô-un sư-rơ-ghi, cơ-ul xô-gê nan'),
    (38, 'Pa-ran chơ ha-nư-rưl uôn-mang-ha-chi nan'),
    (39, 'Ga-kkưm ne-ryơ-nô-kô xi-pơ-chơ, ai-uô-na-xêi gút-bai'),
    (40, 'I gi-rưi kkư-tê bang-hwang-i kkưt-na-myơn'),
    (41, 'Pu-đi hu-huê óp-nưn chê-rô tu nun ga-mưl xu it-gil'),
    (42, 'Lu zờ, uê-tô-ri, sen chờ-kha-nưn kơp-cheng-i'),
    (43, 'Mốt-tuên yang-a-chi, cơ-ul xô-gê nơn'),
    (44, 'Chớt-tờ lu zờ, uê-tô-ri, sang-chơ-pu-nin mơ-chơ-ri'),
    (45, 'Tơ-rô-un sư-rơ-ghi, cơ-ul xô-gê nan, ai-mờ'),
    (46, 'Lu zờ'),
    (47, 'Ai-mờ lu zờ'),
    (48, 'Ai-mờ lu zờ, ê-hây'),
    (49, 'Ai-mờ lu zờ, hưm-hưm')
) as pronunciations(display_order, viet_han)
where line.display_order = pronunciations.display_order
  and line.song_id = (
    select id
    from public.songs
    where title = 'BIGBANG – LOSER'
    order by created_at desc
    limit 1
  );
