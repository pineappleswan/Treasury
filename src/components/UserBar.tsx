type UserBarProps = {
  username: string
};

function UserBar(props: UserBarProps) {
  return (
    <div class="flex flex-row items-center justify-center mt-1.5 w-[100%]">
      <div class="flex items-center py-2 w-[95%] bg-[#f1f1f1] border-solid border-[1px] border-[#dfdfdf] rounded-md">
        <div class="flex rounded-full aspect-square ml-4 mr-3 h-10 bg-slate-400"></div>
        <h1 class="font-SpaceGrotesk font-semibold text- mr-4 text-center text-slate-900 overflow-auto text-wrap break-words">{props.username}</h1>
      </div>
    </div>
  );
}

export default UserBar;
