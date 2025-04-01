import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import {
  getAddress,
  getContract,
  Address,
  PublicClient,
  WalletClient,
  GetContractReturnType,
} from "viem";
import { bscTestnet } from "viem/chains";

const months6 = 6 * 30 * 24 * 60 * 60;

describe("TokenVesting", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await hre.viem.getWalletClients({
      chain: bscTestnet,
    });

    const tokenContract = await hre.viem.deployContract("Weed", [
      owner.account.address,
      owner.account.address,
    ]);

    const tokenVestingContract = await hre.viem.deployContract("TokenVesting", [
      tokenContract.address,
    ]);

    const publicClient = await hre.viem.getPublicClient({ chain: bscTestnet });

    return {
      owner,
      otherAccount,
      publicClient,
      tokenContract,
      tokenVestingContract,
    };
  }

  async function mintAndTokenTransfer({
    mintAmount = BigInt(100_000_000 * 10 ** 18),
    to,
    transferAmount,
    tokenContract,
    publicClient,
    owner,
  }: {
    mintAmount?: BigInt;
    to: Address;
    transferAmount: BigInt;
    tokenContract: GetContractReturnType;
    publicClient: PublicClient;
    owner: WalletClient;
  }) {
    const tokenOwnerWC = getContract({
      abi: tokenContract.abi,
      address: tokenContract.address,
      client: owner,
    });

    tokenOwnerWC.write.mint([getAddress(owner.account!.address), mintAmount]);

    const hash = await tokenOwnerWC.write.transfer([
      getAddress(to),
      transferAmount,
    ]);

    await publicClient.waitForTransactionReceipt({ hash });
  }

  describe("Deployment", function () {
    it("Should set the right token", async function () {
      const { tokenVestingContract, tokenContract } = await loadFixture(
        deployFixture
      );

      expect(await tokenVestingContract.read.getToken()).to.equal(
        getAddress(tokenContract.address)
      );
    });

    it("Should set the right owner", async function () {
      const { tokenVestingContract, owner } = await loadFixture(deployFixture);

      expect(await tokenVestingContract.read.owner()).to.equal(
        getAddress(owner.account.address)
      );
    });

    it("Should send vesting tokens to vesting contract", async function () {
      const { tokenVestingContract, owner, tokenContract, publicClient } =
        await loadFixture(deployFixture);

      const tokenOwnerWC = getContract({
        abi: tokenContract.abi,
        address: tokenContract.address,
        client: owner,
      });

      tokenOwnerWC.write.mint([
        getAddress(owner.account.address),
        BigInt(100_000_000 * 10 ** 18),
      ]);

      const hash = await tokenOwnerWC.write.transfer([
        getAddress(tokenVestingContract.address),
        BigInt(20_000_000 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      expect(
        await tokenContract.read.balanceOf([tokenVestingContract.address])
      ).to.equal(BigInt(20_000_000 * 10 ** 18));
    });
  });

  describe("Vesting Creation", function () {
    it("Should create vesting", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      const count =
        await tokenVestingContract.read.getVestingSchedulesCountByBeneficiary([
          beneficiary,
        ]);

      expect(count).to.equal(1n);

      const schedule =
        await tokenVestingContract.read.getVestingScheduleByAddressAndIndex([
          beneficiary,
          0n,
        ]);

      expect(schedule.beneficiary).to.equal(beneficiary);
      expect(schedule.slicePeriodSeconds).to.equal(1n);
      expect(schedule.duration).to.equal(BigInt(2 * months6));
      expect(schedule.releaseAfterCliff).to.equal(
        BigInt((1 * 10 ** 18 * 20) / 100)
      );
      expect(schedule.cliff).to.equal(BigInt(latestTimestamp + months6));
    });

    it("Should allow only owner to create vesting", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      await expect(
        beneficiaryWC.write.createVestingSchedule([
          beneficiary,
          BigInt(latestTimestamp),
          BigInt(months6),
          20n,
          BigInt(2 * months6),
          1n,
          false,
          BigInt(1 * 10 ** 18),
        ])
      ).to.be.rejectedWith(
        `OwnableUnauthorizedAccount("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")`
      );
    });

    it("Should have zero releasable amount before cliff", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      const count =
        await tokenVestingContract.read.getVestingSchedulesCountByBeneficiary([
          beneficiary,
        ]);

      expect(count).to.equal(1n);

      // after 3 months
      await time.increase(months6 / 2);

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      expect(releasableAmount).to.equal(0n);
    });

    it("Should have releasable amount after cliff", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      const count =
        await tokenVestingContract.read.getVestingSchedulesCountByBeneficiary([
          beneficiary,
        ]);

      expect(count).to.equal(1n);

      // after 3 months
      await time.increase(months6 - 1);

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      expect(releasableAmount).to.equal(BigInt((1 * 10 ** 18 * 20) / 100));
    });

    it("Should have all amount releasable after duration", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      const count =
        await tokenVestingContract.read.getVestingSchedulesCountByBeneficiary([
          beneficiary,
        ]);

      expect(count).to.equal(1n);

      // after 3 months
      await time.increase(3 * months6 - 1);

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      expect(releasableAmount).to.equal(BigInt(1 * 10 ** 18));
    });

    it("Should have linear release after cliff", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      const count =
        await tokenVestingContract.read.getVestingSchedulesCountByBeneficiary([
          beneficiary,
        ]);

      expect(count).to.equal(1n);

      // after 12 months, 6month cliff + a half of duration
      await time.increase(2 * months6 - 1);

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      expect(releasableAmount).to.equal(
        BigInt(1 * 10 ** 18 * 0.2) + BigInt(1 * 10 ** 18 * 0.4)
      );
    });
  });

  describe("Vesting Release", function () {
    it("Should allow to release beneficiaries tokens after cliff", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const initialBalance = await tokenContract.read.balanceOf([beneficiary]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      await time.increase(BigInt(months6));

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      const releaseHash = await beneficiaryWC.write.release(
        [scheduleHash, releasableAmount],
        { account: beneficiary }
      );

      const res = await publicClient.waitForTransactionReceipt({
        hash: releaseHash,
      });

      expect(res.status).to.equal("success");

      const afterReleaseBalance = await tokenContract.read.balanceOf([
        beneficiary,
      ]);

      const balanceChangedAmount = afterReleaseBalance - initialBalance;

      expect(releasableAmount).to.equal(balanceChangedAmount);
    });
    it("Should not allow to release beneficiaries more tokens than available for release", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const initialBalance = await tokenContract.read.balanceOf([beneficiary]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      await time.increase(BigInt(months6));

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      await expect(
        beneficiaryWC.write.release(
          [scheduleHash, releasableAmount + 1n * BigInt(10 ** 18)],
          { account: beneficiary }
        )
      ).to.be.rejectedWith(
        "TokenVesting: cannot release tokens, not enough vested tokens"
      );
    });
    it("Should not allow third party account to release tokens to beneficiary", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const initialBalance = await tokenContract.read.balanceOf([beneficiary]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      await time.increase(BigInt(months6));

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      await expect(
        beneficiaryWC.write.release([scheduleHash, releasableAmount], {
          account: beneficiaryAddresses[1],
        })
      ).to.be.rejectedWith(
        "TokenVesting: only beneficiary and owner can release vested tokens"
      );
    });

    it("Should allow an owner account to release tokens to beneficiary", async function () {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const initialBalance = await tokenContract.read.balanceOf([beneficiary]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const latestTimestamp = await time.latest();

      const hash = await ownerWC.write.createVestingSchedule([
        beneficiary,
        BigInt(latestTimestamp),
        BigInt(months6),
        20n,
        BigInt(2 * months6),
        1n,
        false,
        BigInt(1 * 10 ** 18),
      ]);

      await publicClient.waitForTransactionReceipt({ hash });

      await time.increase(BigInt(months6));

      const scheduleHash =
        await tokenVestingContract.read.computeVestingScheduleIdForAddressAndIndex(
          [beneficiary, 0n]
        );

      const releasableAmount =
        await tokenVestingContract.read.computeReleasableAmount([scheduleHash]);

      const releaseHash = await ownerWC.write.release(
        [scheduleHash, releasableAmount],
        {
          account: getAddress(owner.account.address),
        }
      );

      await publicClient.waitForTransactionReceipt({ hash: releaseHash });

      const afterReleaseBalance = await tokenContract.read.balanceOf([
        beneficiary,
      ]);

      expect(initialBalance).to.equal(afterReleaseBalance - releasableAmount);
    });
  });

  describe("Vesting Withdraw", function () {
    it("Should allow to withdraw tokens by owner", async () => {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[0]);

      const initialOwnerBalance = await tokenContract.read.balanceOf([
        getAddress(owner.account.address),
      ]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      const withdrawableAmount =
        await tokenVestingContract.read.getWithdrawableAmount();

      const hash = await ownerWC.write.withdraw([withdrawableAmount / 2n], {
        account: getAddress(owner.account.address),
      });

      await publicClient.waitForTransactionReceipt({ hash });

      const afterWithdrawBalance = await tokenContract.read.balanceOf([
        getAddress(owner.account.address),
      ]);

      expect(afterWithdrawBalance).to.equal(
        initialOwnerBalance + withdrawableAmount / 2n
      );
    });
    it("Should NOT allow to withdraw tokens by third party", async () => {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const beneficiaryAddresses = await otherAccount.getAddresses();
      const beneficiary = getAddress(beneficiaryAddresses[1]);

      const initialOwnerBalance = await tokenContract.read.balanceOf([
        getAddress(owner.account.address),
      ]);
      const initialBBalance = await tokenContract.read.balanceOf([
        getAddress(beneficiary),
      ]);

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const beneficiaryWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: otherAccount,
      });

      await expect(
        beneficiaryWC.write.withdraw([BigInt(20 * 10 ** 18)], {
          account: beneficiary,
        })
      ).to.be.rejectedWith(`OwnableUnauthorizedAccount`);
    });
    it("Should NOT allow to withdraw more tokens than available", async () => {
      const {
        tokenVestingContract,
        owner,
        otherAccount,
        tokenContract,
        publicClient,
      } = await loadFixture(deployFixture);

      await mintAndTokenTransfer({
        to: getAddress(tokenVestingContract.address),
        transferAmount: BigInt(10_000_000 * 10 ** 18),
        publicClient,
        owner,
        tokenContract,
      });

      const ownerWC = getContract({
        abi: tokenVestingContract.abi,
        address: tokenVestingContract.address,
        client: owner,
      });

      const withdrawableAmount =
        await tokenVestingContract.read.getWithdrawableAmount();

      await expect(
        ownerWC.write.withdraw([withdrawableAmount + 100n], {
          account: getAddress(owner.account.address),
        })
      ).to.be.rejectedWith(`TokenVesting: not enough withdrawable funds`);
    });
  });
});
