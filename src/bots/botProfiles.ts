// ─────────────────────────────────────────────
//  50 ta bot profili — real o'yinchilarga o'xshash
// ─────────────────────────────────────────────

export interface BotProfile {
  uid: string;
  displayName: string;
  photoUrl: string;
  bio: string;
  rating: number;
  level: number;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  style: BotStyle;
  activeHours: number[];
  typingDelayMs: number;
  preferredStakes: number[];
}

export type BotStyle = "aggressive" | "defensive" | "balanced" | "random" | "beginner";

function avatar(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

export const BOT_PROFILES: BotProfile[] = [
  // Tajribali (1400-1850)
  { uid:"bot_amir_k",       displayName:"Amir_K",        photoUrl:avatar("AmirK99"),      bio:"Shashka — bu hayot strategiyasi 🎯",             rating:1720,level:18,xp:9200, wins:312,losses:98, draws:24,totalGames:434, style:"aggressive", activeHours:[19,20,21,22],    typingDelayMs:1200, preferredStakes:[200,1000]    },
  { uid:"bot_sardor88",     displayName:"Sardor88",      photoUrl:avatar("Sardor88"),     bio:"Har kuni mashq qilaman 💪",                       rating:1650,level:16,xp:7800, wins:276,losses:104,draws:31,totalGames:411, style:"balanced",   activeHours:[18,19,20,21],    typingDelayMs:900,  preferredStakes:[200,1000]    },
  { uid:"bot_chess_pro",    displayName:"ChessPro_UZ",   photoUrl:avatar("ChessProUZ"),   bio:"Professional darajada o'ynayman",                 rating:1810,level:20,xp:11200,wins:401,losses:87, draws:45,totalGames:533, style:"defensive",  activeHours:[20,21,22,23],    typingDelayMs:2100, preferredStakes:[1000,5000]   },
  { uid:"bot_nodira_s",     displayName:"Nodira_S",      photoUrl:avatar("NodiraS"),      bio:"Shashka faniga oshiq qiz 🌸",                    rating:1590,level:15,xp:6950, wins:241,losses:112,draws:28,totalGames:381, style:"defensive",  activeHours:[14,15,16,17],    typingDelayMs:1500, preferredStakes:[50,200]      },
  { uid:"bot_jasur_uz",     displayName:"Jasur_UZ",      photoUrl:avatar("JasurUZ"),      bio:"O'ynamasangiz yutolmaysiz!",                      rating:1480,level:13,xp:5600, wins:198,losses:134,draws:19,totalGames:351, style:"aggressive", activeHours:[21,22,23],       typingDelayMs:700,  preferredStakes:[200,1000]    },
  { uid:"bot_malika99",     displayName:"Malika99",      photoUrl:avatar("Malika99"),     bio:"Strategiya va sabr — g'alaba kaliti ✨",          rating:1420,level:12,xp:4900, wins:167,losses:119,draws:22,totalGames:308, style:"balanced",   activeHours:[11,12,13,20,21], typingDelayMs:1800, preferredStakes:[50,200]      },
  { uid:"bot_bekzod_t",     displayName:"BekzodTashkent",photoUrl:avatar("BekzodT"),      bio:"Toshkentlik kuchli raqib 🦁",                    rating:1750,level:19,xp:10100,wins:334,losses:91, draws:37,totalGames:462, style:"aggressive", activeHours:[8,9,10,20,21,22],typingDelayMs:800,  preferredStakes:[1000,5000]   },
  { uid:"bot_dilnoza_m",    displayName:"Dilnoza_M",     photoUrl:avatar("DilnozaM"),     bio:"Har o'yin yangi tajriba 🌟",                     rating:1380,level:11,xp:4200, wins:145,losses:128,draws:17,totalGames:290, style:"balanced",   activeHours:[12,13,14,15],    typingDelayMs:2000, preferredStakes:[50,200]      },
  { uid:"bot_bekzod2",      displayName:"BekzodStar",    photoUrl:avatar("BekzodStar"),   bio:"Yulduz bo'lishga intilaman ⭐",                  rating:1460,level:13,xp:5400, wins:189,losses:127,draws:21,totalGames:337, style:"balanced",   activeHours:[17,18,19,20],    typingDelayMs:1100, preferredStakes:[200,1000]    },
  // O'rta (1100-1400)
  { uid:"bot_otabek_r",     displayName:"Otabek_R",      photoUrl:avatar("OtabekR"),      bio:"Mashq qilmoqdaman hali 📚",                      rating:1320,level:9, xp:3100, wins:112,losses:134,draws:14,totalGames:260, style:"balanced",   activeHours:[17,18,19,20],    typingDelayMs:1100, preferredStakes:[50,200]      },
  { uid:"bot_sherzod_n",    displayName:"Sherzod_N",     photoUrl:avatar("SherzodN"),     bio:"Do'stlar bilan o'ynash yaxshi 😄",               rating:1280,level:8, xp:2800, wins:98, losses:121,draws:11,totalGames:230, style:"random",     activeHours:[19,20,21,22,23], typingDelayMs:600,  preferredStakes:[50,200]      },
  { uid:"bot_kamola_uz",    displayName:"Kamola_UZ",     photoUrl:avatar("KamolaUZ"),     bio:"Yutish uchun o'rganmoqdaman 🎓",                 rating:1190,level:7, xp:2200, wins:78, losses:112,draws:9, totalGames:199, style:"beginner",   activeHours:[15,16,17,18],    typingDelayMs:2500, preferredStakes:[50]          },
  { uid:"bot_ulugbek_s",    displayName:"Ulugbek_S",     photoUrl:avatar("UlugbekS"),     bio:"Samarqanddan salom! 🏛️",                        rating:1350,level:10,xp:3500, wins:124,losses:118,draws:16,totalGames:258, style:"defensive",  activeHours:[9,10,11,12],     typingDelayMs:1700, preferredStakes:[50,200]      },
  { uid:"bot_feruza_b",     displayName:"Feruza_B",      photoUrl:avatar("FeruzaB"),      bio:"Sevimli o'yinim 💙",                             rating:1160,level:6, xp:1900, wins:67, losses:98, draws:8, totalGames:173, style:"balanced",   activeHours:[13,14,15,16,17], typingDelayMs:1900, preferredStakes:[50]          },
  { uid:"bot_alisher_t",    displayName:"Alisher_T",     photoUrl:avatar("AlisherT"),     bio:"Har kuni bir oz yaxshilanmoqdaman 📈",            rating:1240,level:7, xp:2400, wins:87, losses:109,draws:12,totalGames:208, style:"balanced",   activeHours:[20,21,22],       typingDelayMs:1300, preferredStakes:[50,200]      },
  { uid:"bot_zulfiya_k",    displayName:"Zulfiya_K",     photoUrl:avatar("ZulfiyaK"),     bio:"Qizlar ham o'ynaydi! 💅",                       rating:1310,level:9, xp:3000, wins:108,losses:123,draws:13,totalGames:244, style:"aggressive", activeHours:[10,11,12,19,20], typingDelayMs:1000, preferredStakes:[50,200]      },
  { uid:"bot_bobur_a",      displayName:"Bobur_A",       photoUrl:avatar("BoburA"),       bio:"Farg'onalik o'yinchi 🌄",                       rating:1200,level:7, xp:2100, wins:74, losses:103,draws:10,totalGames:187, style:"random",     activeHours:[18,19,20,21],    typingDelayMs:800,  preferredStakes:[50,200]      },
  { uid:"bot_muazzam_r",    displayName:"Muazzam_R",     photoUrl:avatar("MuazzamR"),     bio:"Onlayn o'yinlar — dam olish 🎮",                 rating:1170,level:6, xp:1850, wins:63, losses:95, draws:7, totalGames:165, style:"defensive",  activeHours:[21,22,23],       typingDelayMs:2200, preferredStakes:[50]          },
  { uid:"bot_sanjar_d",     displayName:"Sanjar_D",      photoUrl:avatar("SanjarD"),      bio:"G'alaba — mening maqsadim 🏆",                  rating:1390,level:11,xp:4100, wins:141,losses:115,draws:18,totalGames:274, style:"aggressive", activeHours:[7,8,9,20,21],    typingDelayMs:900,  preferredStakes:[200,1000]    },
  { uid:"bot_nargiza_uz",   displayName:"Nargiza_UZ",    photoUrl:avatar("NargizaUZ"),    bio:"Taktik o'yinlarni yaxshi ko'raman 🧩",          rating:1260,level:8, xp:2600, wins:92, losses:115,draws:11,totalGames:218, style:"defensive",  activeHours:[14,15,16,17,18], typingDelayMs:1600, preferredStakes:[50,200]      },
  { uid:"bot_doniyor_m",    displayName:"Doniyor_M",     photoUrl:avatar("DoniyorM"),     bio:"Andijondan salom 👋",                            rating:1140,level:5, xp:1600, wins:54, losses:89, draws:6, totalGames:149, style:"beginner",   activeHours:[16,17,18,19],    typingDelayMs:3000, preferredStakes:[50]          },
  // Yangilar (800-1100)
  { uid:"bot_laylo_n",      displayName:"Laylo_N",       photoUrl:avatar("LayloN"),       bio:"Yangi boshladim, o'rganmoqdaman 😊",             rating:980, level:3, xp:700,  wins:28, losses:61, draws:5, totalGames:94,  style:"beginner",   activeHours:[15,16,17],       typingDelayMs:3500, preferredStakes:[50]          },
  { uid:"bot_timur_uz",     displayName:"Timur_UZ",      photoUrl:avatar("TimurUZ"),      bio:"Shashka o'rganmoqdaman 📖",                      rating:1020,level:3, xp:800,  wins:31, losses:57, draws:4, totalGames:92,  style:"beginner",   activeHours:[20,21,22],       typingDelayMs:2800, preferredStakes:[50]          },
  { uid:"bot_hulkar_s",     displayName:"Hulkar_S",      photoUrl:avatar("HulkarS"),      bio:"Do'stlarim o'ynaganini ko'rib boshladim",        rating:870, level:2, xp:400,  wins:18, losses:54, draws:3, totalGames:75,  style:"beginner",   activeHours:[11,12,13],       typingDelayMs:4000, preferredStakes:[50]          },
  { uid:"bot_jahongir_r",   displayName:"Jahongir_R",    photoUrl:avatar("JahongirR"),    bio:"Hali yaxshi emas, lekin o'rganmoqdaman",         rating:950, level:2, xp:500,  wins:22, losses:58, draws:4, totalGames:84,  style:"beginner",   activeHours:[19,20],          typingDelayMs:3200, preferredStakes:[50]          },
  { uid:"bot_mohira_t",     displayName:"Mohira_T",      photoUrl:avatar("MohiraT"),      bio:"Tengdoshlarim bilan o'ynamoqchiman",             rating:1050,level:3, xp:900,  wins:34, losses:52, draws:5, totalGames:91,  style:"random",     activeHours:[14,15,16,21],    typingDelayMs:2600, preferredStakes:[50]          },
  { uid:"bot_aziz_k",       displayName:"Aziz_K",        photoUrl:avatar("AzizK"),        bio:"O'rganmoqdaman hali 🙂",                         rating:1080,level:4, xp:1100, wins:41, losses:64, draws:6, totalGames:111, style:"beginner",   activeHours:[18,19,20],       typingDelayMs:2900, preferredStakes:[50]          },
  { uid:"bot_shahlo_b",     displayName:"Shahlo_B",      photoUrl:avatar("ShahloB"),      bio:"Eng kichik qadamdan boshlash kerak 🌱",          rating:900, level:2, xp:450,  wins:19, losses:52, draws:3, totalGames:74,  style:"beginner",   activeHours:[10,11,12],       typingDelayMs:3800, preferredStakes:[50]          },
  // Maxsus uslublar
  { uid:"bot_night_owl",    displayName:"NightOwl_UZ",   photoUrl:avatar("NightOwl"),     bio:"Faqat kechasi o'ynayman 🦉",                     rating:1540,level:14,xp:6200, wins:213,losses:131,draws:26,totalGames:370, style:"aggressive", activeHours:[23,0,1,2],       typingDelayMs:700,  preferredStakes:[200,1000]    },
  { uid:"bot_earlybird",    displayName:"EarlyBird",     photoUrl:avatar("EarlyBird"),    bio:"Erta turgan — erga yetgan 🌅",                   rating:1470,level:13,xp:5800, wins:194,losses:127,draws:22,totalGames:343, style:"defensive",  activeHours:[5,6,7,8],        typingDelayMs:1400, preferredStakes:[200]         },
  { uid:"bot_flash_uz",     displayName:"Flash_UZ",      photoUrl:avatar("FlashUZ"),      bio:"Tezlik — mening qurolim ⚡",                    rating:1680,level:17,xp:8900, wins:298,losses:104,draws:32,totalGames:434, style:"aggressive", activeHours:[12,13,20,21,22], typingDelayMs:400,  preferredStakes:[1000,5000]   },
  { uid:"bot_patient_one",  displayName:"Patient_UZ",    photoUrl:avatar("PatientUZ"),    bio:"Sabr — g'alaba asosi 🧘",                       rating:1620,level:15,xp:7200, wins:254,losses:112,draws:41,totalGames:407, style:"defensive",  activeHours:[9,10,11,16,17],  typingDelayMs:3000, preferredStakes:[200,1000]    },
  { uid:"bot_lucky_uz",     displayName:"Lucky_UZ",      photoUrl:avatar("LuckyUZ"),      bio:"Ba'zan omad ham kerak 🍀",                       rating:1130,level:5, xp:1700, wins:59, losses:94, draws:8, totalGames:161, style:"random",     activeHours:[10,15,20,22],    typingDelayMs:1500, preferredStakes:[50,200]      },
  { uid:"bot_comeback",     displayName:"Comeback_UZ",   photoUrl:avatar("ComebackUZ"),   bio:"Hech qachon taslim bo'lmayman 🔥",               rating:1440,level:12,xp:5100, wins:178,losses:152,draws:21,totalGames:351, style:"aggressive", activeHours:[18,19,20,21,22], typingDelayMs:900,  preferredStakes:[200,1000]    },
  { uid:"bot_quiet_storm",  displayName:"QuietStorm",    photoUrl:avatar("QuietStorm"),   bio:"Ko'p gapirmayman, ko'p o'ylayman 🤫",           rating:1560,level:14,xp:6400, wins:221,losses:118,draws:30,totalGames:369, style:"defensive",  activeHours:[23,0,9,10],      typingDelayMs:2500, preferredStakes:[200,1000]    },
  { uid:"bot_weekend",      displayName:"Weekend_UZ",    photoUrl:avatar("WeekendUZ"),    bio:"Faqat dam olish kunlari o'ynayman 📅",           rating:1180,level:6, xp:2000, wins:71, losses:98, draws:9, totalGames:178, style:"balanced",   activeHours:[10,11,12,13,14], typingDelayMs:1700, preferredStakes:[50,200]      },
  { uid:"bot_buvi",         displayName:"Buvi_Shashka",  photoUrl:avatar("BuviShashka"),  bio:"30 yildan beri o'ynayman 👵",                   rating:1700,level:18,xp:9800, wins:345,losses:96, draws:43,totalGames:484, style:"defensive",  activeHours:[9,10,11,14,15],  typingDelayMs:2800, preferredStakes:[50,200]      },
  { uid:"bot_schoolboy",    displayName:"Schoolboy_UZ",  photoUrl:avatar("SchoolboyUZ"),  bio:"Maktabdan keyin o'ynayman 📐",                  rating:1090,level:4, xp:1200, wins:43, losses:67, draws:6, totalGames:116, style:"random",     activeHours:[14,15,16,17],    typingDelayMs:2000, preferredStakes:[50]          },
  { uid:"bot_tournament",   displayName:"Turnir_UZ",     photoUrl:avatar("TurnirUZ"),     bio:"Turnirlardan chiqa olmayman 🏅",                 rating:1780,level:19,xp:10600,wins:378,losses:89, draws:49,totalGames:516, style:"defensive",  activeHours:[18,19,20,21],    typingDelayMs:1900, preferredStakes:[1000,5000,10000]},
  { uid:"bot_streamer",     displayName:"Streamer_UZ",   photoUrl:avatar("StreamerUZ"),   bio:"Men o'ynayapman, siz tomosha qiling 🎥",        rating:1360,level:10,xp:3700, wins:131,losses:119,draws:17,totalGames:267, style:"aggressive", activeHours:[20,21,22,23],    typingDelayMs:600,  preferredStakes:[200,1000]    },
  { uid:"bot_engineer",     displayName:"Engineer_UZ",   photoUrl:avatar("EngineerUZ"),   bio:"Mantiqiy fikrlash dasturchilar uchun ham foydali 💻",rating:1580,level:15,xp:7100,wins:238,losses:117,draws:28,totalGames:383,style:"defensive",activeHours:[12,13,21,22],   typingDelayMs:1100, preferredStakes:[200,1000]    },
  { uid:"bot_doctor",       displayName:"Dr_Shashka",    photoUrl:avatar("DrShashka"),    bio:"Miyani dam oldirish uchun o'ynayman 🩺",        rating:1430,level:12,xp:5000, wins:168,losses:126,draws:21,totalGames:315, style:"balanced",   activeHours:[13,14,22,23],    typingDelayMs:1600, preferredStakes:[200]         },
  { uid:"bot_student",      displayName:"Student_UZ",    photoUrl:avatar("StudentUZ"),    bio:"Imtihon orasida biroz o'ynayman 😅",             rating:1120,level:5, xp:1500, wins:51, losses:82, draws:7, totalGames:140, style:"random",     activeHours:[13,14,23,0],     typingDelayMs:2200, preferredStakes:[50]          },
  { uid:"bot_veteran",      displayName:"Veteran_UZ",    photoUrl:avatar("VeteranUZ"),    bio:"Ko'p ko'rganman, ko'p o'ynaganman 🏅",          rating:1660,level:16,xp:8100, wins:279,losses:109,draws:36,totalGames:424, style:"defensive",  activeHours:[9,10,11,15,16,17],typingDelayMs:2400,preferredStakes:[50,200]      },
  { uid:"bot_teen",         displayName:"Teen_UZ",       photoUrl:avatar("TeenUZ"),       bio:"17 yoshda professional bo'laman 💪",             rating:1290,level:8, xp:2900, wins:101,losses:118,draws:14,totalGames:233, style:"aggressive", activeHours:[15,16,17,21,22], typingDelayMs:700,  preferredStakes:[50,200]      },
  { uid:"bot_farmer",       displayName:"Farmer_UZ",     photoUrl:avatar("FarmerUZ"),     bio:"Kechqurun ishdan so'ng o'ynayman 🌾",           rating:1220,level:7, xp:2300, wins:83, losses:107,draws:12,totalGames:202, style:"balanced",   activeHours:[20,21,22],       typingDelayMs:2100, preferredStakes:[50]          },
  { uid:"bot_bigmoney",     displayName:"BigMoney_UZ",   photoUrl:avatar("BigMoneyUZ"),   bio:"Katta stakeda o'ynayman 💰",                    rating:1830,level:20,xp:11800,wins:421,losses:82, draws:51,totalGames:554, style:"aggressive", activeHours:[21,22,23],       typingDelayMs:500,  preferredStakes:[5000,10000]  },
  { uid:"bot_analyzer",     displayName:"Analyzer_UZ",   photoUrl:avatar("AnalyzerUZ"),   bio:"Har harakatni tahlil qilaman 🔍",               rating:1710,level:18,xp:9600, wins:319,losses:101,draws:42,totalGames:462, style:"defensive",  activeHours:[10,11,19,20,21], typingDelayMs:2700, preferredStakes:[1000]        },
  { uid:"bot_champion",     displayName:"Champion_UZ",   photoUrl:avatar("ChampionUZ"),   bio:"Hech kim meni yenga olmaydi! 👑",               rating:1850,level:21,xp:12400,wins:445,losses:79, draws:56,totalGames:580, style:"aggressive", activeHours:[20,21,22,23],    typingDelayMs:600,  preferredStakes:[5000,10000]  },
];

export const BOT_UIDS = new Set(BOT_PROFILES.map(b => b.uid));
export const isBotUid = (uid: string): boolean => BOT_UIDS.has(uid);
