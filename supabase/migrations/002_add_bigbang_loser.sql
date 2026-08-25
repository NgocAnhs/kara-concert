with inserted_song as (
  insert into public.songs (title, youtube_url, status)
  values ('BIGBANG – LOSER', 'https://www.youtube.com/watch?v=1CTced9CMMk', 'published')
  returning id
)
insert into public.lyric_lines (
  song_id,
  korean,
  romanization,
  meaning,
  display_order,
  start_seconds,
  end_seconds
)
select
  inserted_song.id,
  lines.korean,
  lines.romanization,
  lines.meaning,
  lines.display_order,
  lines.start_seconds,
  lines.end_seconds
from inserted_song
cross join (
  values
    ('LOSER 외톨이 센 척하는 겁쟁이', 'Loser oetori sen cheokhaneun geopjaengi', 'Kẻ thất bại, cô độc, một kẻ hèn nhát giả vờ mạnh mẽ.', 0, 0.66, 5.84),
    ('못된 양아치 거울 속에 넌', 'Motdoen yangachi geoul soge neon', 'Kẻ xấu xa trong gương chính là bạn.', 1, 5.84, 10.46),
    ('Just a LOSER 외톨이 상처뿐인 머저리', 'Just a loser oetori sangcheoppunin meojeori', 'Chỉ là kẻ thất bại cô độc, một kẻ ngốc đầy vết thương.', 2, 10.46, 16.46),
    ('더러운 쓰레기 거울 속에 난 I''m a', 'Deoreoun sseuregi geoul soge nan, I''m a', 'Tôi trong gương là thứ rác rưởi bẩn thỉu, tôi là…', 3, 16.46, 22.12),
    ('솔직히 세상과 난 어울린 적 없어', 'Soljikhi sesanggwa nan eoullin jeok eopseo', 'Thật lòng mà nói, tôi chưa từng hợp với thế giới này.', 4, 22.12, 24.78),
    ('홀로였던 내겐 사랑 따윈 벌써', 'Holloyeotdeon naegen sarang ttawin beolsseo', 'Với người vốn cô độc như tôi, tình yêu đã…', 5, 24.78, 27.46),
    ('잊혀진 지 오래 저 시간 속에', 'Ithyeojin ji orae jeo sigan soge', '… bị lãng quên từ lâu trong quãng thời gian đó.', 6, 27.46, 29.78),
    ('더 이상은 못 듣겠어 희망찬 사랑 노래', 'Deo isangeun mot deutgesseo huimangchan sarang norae', 'Tôi không thể nghe thêm những bài tình ca đầy hy vọng nữa.', 7, 29.78, 32.71),
    ('너나 나나 그저 길들여진 대로', 'Neona nana geujeo gildeuryeojin daero', 'Bạn và tôi chỉ sống theo cách đã được thuần hóa.', 8, 32.71, 35.42),
    ('각본 속에 놀아나는 슬픈 삐에로', 'Gakbon soge norananeun seulpeun ppiero', 'Những chú hề buồn bị điều khiển trong kịch bản.', 9, 35.42, 38.09),
    ('난 멀리 와버렸어 I''m coming home', 'Nan meolli wabeoryeosseo, I''m coming home', 'Tôi đã đi quá xa rồi, tôi đang trở về nhà.', 10, 38.09, 40.22),
    ('이제 다시 돌아갈래 어릴 적 제자리로', 'Ije dasi doragallae eoril jeok jejariro', 'Giờ tôi muốn trở về nơi mình từng thuộc về khi còn nhỏ.', 11, 40.22, 43.17),
    ('언제부턴가 난 yeah', 'Eonjebuteonga nan, yeah', 'Từ lúc nào đó, tôi…', 12, 43.17, 48.14),
    ('하늘보다 땅을 더 바라보게 돼', 'Haneul boda ttangeul deo baraboge dwae', '… nhìn xuống đất nhiều hơn nhìn lên trời.', 13, 48.14, 53.43),
    ('숨쉬기조차 힘겨워', 'Sumswigijocha himgyeowo', 'Ngay cả thở cũng thật khó khăn.', 14, 53.43, 58.81),
    ('손을 뻗지만', 'Soneul ppeotjiman', 'Tôi đưa tay ra…', 15, 58.81, 59.68),
    ('그 누구도 날 잡아주질 않네 I''m a', 'Geu nugudo nal jaba jujil anne, I''m a', '… nhưng chẳng ai nắm lấy tay tôi. Tôi là…', 16, 59.68, 64.45),
    ('LOSER 외톨이 센 척하는 겁쟁이', 'Loser, oetori, sen cheokhaneun geopjaengi', 'Kẻ thất bại, cô độc, một kẻ hèn nhát giả vờ mạnh mẽ.', 17, 64.45, 69.78),
    ('못된 양아치 거울 속에 넌', 'Motdoen yangachi geoul soge neon', 'Kẻ xấu xa trong gương chính là bạn.', 18, 69.78, 74.43),
    ('Just a LOSER 외톨이 상처뿐인 머저리', 'Just a loser, oetori, sangcheoppunin meojeori', 'Chỉ là kẻ thất bại cô độc, một kẻ ngốc đầy vết thương.', 19, 74.43, 80.42),
    ('더러운 쓰레기 거울 속에 난 I''m a', 'Deoreoun sseuregi geoul soge nan, I''m a', 'Tôi trong gương là thứ rác rưởi bẩn thỉu, tôi là…', 20, 80.42, 85.70),
    ('반복되는 여자들과의 내 실수', 'Yo, banbokdoeneun yeojadeulgwaui nae silsu', 'Những lỗi lầm lặp lại của tôi với phụ nữ.', 21, 85.70, 88.46),
    ('하룻밤을 사랑하고 해 뜨면 싫증', 'Harutbameul saranghago hae tteumyeon siljeung', 'Yêu trong một đêm rồi chán khi mặt trời lên.', 22, 88.46, 91.15),
    ('책임지지 못 할 나의 이기적인 기쁨', 'Chaegimjiji mot hal naui igijeogin gippeum', 'Niềm vui ích kỷ mà tôi không thể chịu trách nhiệm.', 23, 91.15, 93.50),
    ('하나 땜에 모든 것이 망가져버린 지금', 'Hana ttaeme modeun geosi manggajyeobeorin jigeum', 'Vì một điều mà giờ mọi thứ đã tan vỡ.', 24, 93.50, 96.18),
    ('멈출 줄 모르던 나의 위험한 질주', 'Meomchul jul moreudeon naui wiheomhan jilju', 'Cuộc lao đi nguy hiểm của tôi, vốn không biết dừng.', 25, 96.18, 98.86),
    ('이젠 아무런 감흥도 재미도 없는 기분', 'Ijen amureon gamheungdo jaemido eomneun gibun', 'Giờ đây là cảm giác không còn hứng thú hay niềm vui.', 26, 98.86, 101.71),
    ('나 벼랑 끝에 혼자 있네 I''m going home', 'Na byeorang kkeute honja inne, I''m going home', 'Tôi đứng một mình nơi mép vực, tôi đang về nhà.', 27, 101.71, 104.34),
    ('나 다시 돌아갈래 예전의 제자리로', 'Na dasi doragallae yejeonui jejariro', 'Tôi muốn trở về vị trí cũ của mình.', 28, 104.34, 106.99),
    ('언제부턴가 난 yeah', 'Eonjebuteonga nan, yeah', 'Từ lúc nào đó, tôi…', 29, 106.99, 112.11),
    ('사람들의 시선을 두려워만 해', 'Saramdeurui siseoneul duryeowoman hae', 'Tôi chỉ sợ ánh nhìn của mọi người.', 30, 112.11, 117.54),
    ('우는 것조차 지겨워', 'Uneun geotjocha jigyeowo', 'Ngay cả khóc tôi cũng thấy chán ngán.', 31, 117.54, 122.78),
    ('웃어보지만', 'Useobojiman', 'Tôi cố cười…', 32, 122.78, 123.68),
    ('그 아무도 날 알아주질 않네 I''m a', 'Geu amudo nal arajujil anne, I''m a', '… nhưng chẳng ai hiểu tôi. Tôi là…', 33, 123.68, 128.53),
    ('LOSER 외톨이 센 척하는 겁쟁이', 'Loser, oetori, sen cheokhaneun geopjaengi', 'Kẻ thất bại, cô độc, một kẻ hèn nhát giả vờ mạnh mẽ.', 34, 128.53, 133.75),
    ('못된 양아치 거울 속에 넌', 'Motdoen yangachi geoul soge neon', 'Kẻ xấu xa trong gương chính là bạn.', 35, 133.75, 138.43),
    ('Just a LOSER 외톨이 상처뿐인 머저리', 'Just a loser, oetori, sangcheoppunin meojeori', 'Chỉ là kẻ thất bại cô độc, một kẻ ngốc đầy vết thương.', 36, 138.43, 144.43),
    ('더러운 쓰레기 거울 속에 난', 'Deoreoun sseuregi geoul soge nan', 'Tôi trong gương là thứ rác rưởi bẩn thỉu.', 37, 144.43, 149.50),
    ('파란 저 하늘을 원망하지 난', 'Paran jeo haneureul wonmanghaji nan', 'Tôi trách bầu trời xanh kia.', 38, 149.50, 154.66),
    ('가끔 내려놓고 싶어져 I want to say goodbye', 'Gakkeum naeryeonoko sipeojyeo, I wanna say goodbye', 'Đôi khi tôi muốn buông hết, tôi muốn nói lời tạm biệt.', 39, 154.66, 160.12),
    ('이 길의 끝에 방황이 끝나면', 'I girui kkeute banghwangi kkeutnamyeon', 'Khi sự lang thang kết thúc ở cuối con đường này…', 40, 160.12, 165.16),
    ('부디 후회 없는 채로 두 눈 감을 수 있길', 'Budi huhoe eomneun chaero du nun gameul su itgil', 'Ước gì tôi có thể nhắm mắt mà không hối tiếc.', 41, 165.16, 171.04),
    ('LOSER 외톨이 센 척하는 겁쟁이', 'Loser, oetori, sen cheokhaneun geopjaengi', 'Kẻ thất bại, cô độc, một kẻ hèn nhát giả vờ mạnh mẽ.', 42, 171.04, 176.40),
    ('못된 양아치 거울 속에 넌', 'Motdoen yangachi geoul soge neon', 'Kẻ xấu xa trong gương chính là bạn.', 43, 176.40, 181.12),
    ('Just a LOSER 외톨이 상처뿐인 머저리', 'Just a loser, oetori, sangcheoppunin meojeori', 'Chỉ là kẻ thất bại cô độc, một kẻ ngốc đầy vết thương.', 44, 181.12, 187.12),
    ('더러운 쓰레기 거울 속에 난 I''m a', 'Deoreoun sseuregi geoul soge nan, I''m a', 'Tôi trong gương là thứ rác rưởi bẩn thỉu, tôi là…', 45, 187.12, 192.37),
    ('LOSER', 'Loser', 'Kẻ thất bại.', 46, 192.37, 197.34),
    ('I''m a LOSER', 'I''m a loser', 'Tôi là kẻ thất bại.', 47, 197.34, 202.70),
    ('I''m a LOSER', 'I''m a loser, eh-hey', 'Tôi là kẻ thất bại.', 48, 202.70, 208.15),
    ('I''m a LOSER', 'I''m a loser, hmm-hmm', 'Tôi là kẻ thất bại.', 49, 208.15, 219.00)
) as lines(korean, romanization, meaning, display_order, start_seconds, end_seconds);
