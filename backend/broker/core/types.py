from enum import Enum


class BrokerCode(str, Enum):
    ANGEL = "angel"
    ARROW = "arrow"
    DHAN = "dhan"
    GROWW = "groww"
    INDMONEY = "indmoney"
    KOTAK = "kotak"
    UPSTOX = "upstox"
    ZERODHA = "zerodha"
