import { Accessor, createSignal } from "solid-js";
import { getFormattedByteSizeText } from "../utility/commonUtils";
import { UserSettings } from "../client/userSettings";
import { StorageQuota } from "../client/userFilesystem";

// Icons
import AvatarIcon from "../assets/icons/svg/avatar.svg?component-solid";

type UserProfileCardContext = {
  setStorageQuota?: (storageQuota: StorageQuota) => void;
}

type UserProfileCardProps = {
  username: string;
  context: UserProfileCardContext;
  userSettings: Accessor<UserSettings>
};

function UserProfileCard(props: UserProfileCardProps) {
  const { username, context, userSettings } = props;
  const [ quotaText, setQuotaText ] = createSignal("Loading usage data...");
  const [ barWidth, setBarWidth ] = createSignal(0); // Bar width is a value between 0 and 100 (must be an integer or else the bar won't show)

  context.setStorageQuota = (storageQuota: StorageQuota) => {
    const { bytesUsed, totalBytes } = storageQuota;

    if (bytesUsed == -1 || totalBytes == -1) {
      setQuotaText("Loading usage data...");
      setBarWidth(0);
    } else {
      let usedQuotaText = getFormattedByteSizeText(bytesUsed, userSettings().dataSizeUnit, 2);
      let totalQuotaText = getFormattedByteSizeText(totalBytes, userSettings().dataSizeUnit, 2);
      let ratio = Math.floor((bytesUsed / totalBytes) * 100);
      
      // Clamp between 0-100
      if (ratio < 0) {
        ratio = 0;
      } else if (ratio > 100) {
        ratio = 100;
      }

      setQuotaText(usedQuotaText + " / " + totalQuotaText);
      setBarWidth(ratio);
    }
  };

  return (
    <div class="flex flex-col w-full py-1 mx-1.5 mt-1.5 bg-slate-200 border-[1px] border-slate-300 rounded-md items-center">
      <div class="flex flex-row w-full">
        <AvatarIcon class="ml-2 mr-1.5 min-w-5 min-h-5 w-5 h-5 text-slate-500" />
        <span class="w-full mr-1.5 font-SpaceGrotesk text-sm font-medium text-slate-700 overflow-auto text-wrap break-words">{username}</span>
      </div>
      <div class="flex flex-col w-full px-1.5">
        <div class="w-full h-1 mt-2 bg-slate-300 rounded-full">
          <div
            style={`width: ${barWidth()}%`}
            class={`
              flex rounded-full h-full
              ${barWidth() < 70 ? "bg-sky-600" : (barWidth() < 90 ? "bg-amber-400" : "bg-red-500")}
            `}
          />
        </div>
        <div class="mt-1 font-SpaceGrotesk font-medium text-xs text-zinc-700">{quotaText()}</div>
      </div>
    </div>
  );
}

export type {
  UserProfileCardContext
};

export {
  UserProfileCard
};
