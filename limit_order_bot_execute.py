import os
import uvloop
import asyncio
from web3 import Web3
from web3.contract import Contract
from dotenv import load_dotenv
from paloma_sdk.core.coins import Coins
from paloma_sdk.core.wasm import MsgExecuteContract
from paloma_sdk.client.lcd import AsyncLCDClient
from paloma_sdk.key.mnemonic import MnemonicKey
from paloma_sdk.client.lcd.api.tx import CreateTxOptions


async def limit_order_bot_execute():
    node: str = os.environ['BNB_NODE']
    w3: Web3 = Web3(Web3.HTTPProvider(node))
    lob_vyper: str = os.environ['PANCAKESWAP_LOB_VYPER']
    lob_abi: str = os.environ['LOB_ABI']
    lob_sc: Contract = w3.eth.contract(
        address=lob_vyper, abi=lob_abi)
    deposit_ids = lob_sc.functions.withdrawable_ids().call()
    print(deposit_ids)

    paloma_lcd = os.environ['PALOMA_LCD']
    paloma_chain_id = os.environ['PALOMA_CHAIN_ID']
    paloma: AsyncLCDClient = AsyncLCDClient(
        url=paloma_lcd, chain_id=paloma_chain_id)
    paloma.gas_prices = "0.01ugrain"
    mnemonic: str = os.environ['PALOMA_KEY']
    acct: MnemonicKey = MnemonicKey(mnemonic=mnemonic)
    wallet = paloma.wallet(acct)

    lob_cw_address = os.environ['PANCAKESWAP_LOB_CW']
    execute_msg = {
        "put_withdraw": {
            "deposit_ids": [
                deposit_ids
            ]
        }
    }
    funds = Coins()
    tx = await wallet.create_and_sign_tx(
        CreateTxOptions(
            msgs=[
                MsgExecuteContract(
                    wallet.key, lob_cw_address, execute_msg, funds
                )
            ]
        )
    )
    result = await paloma.tx.broadcast(tx)
    print(result)


async def main():
    load_dotenv()
    await limit_order_bot_execute()


if __name__ == "__main__":
    uvloop.install()
    asyncio.run(main())
